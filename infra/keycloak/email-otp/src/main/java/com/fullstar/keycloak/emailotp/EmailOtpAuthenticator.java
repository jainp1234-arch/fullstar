package com.fullstar.keycloak.emailotp;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.email.EmailException;
import org.keycloak.email.EmailTemplateProvider;
import org.keycloak.events.Errors;
import org.keycloak.models.AuthenticatorConfigModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.light.LightweightUserAdapter;
import org.keycloak.sessions.AuthenticationSessionModel;

/**
 * Email one-time-code sign-in (Schema §8.1, §8.3). Step 1 asks for the email, step 2 for the
 * 6-digit code sent to it. With "allowUserCreation" (parents) an unknown email gets an account once
 * the code is proven; without it (staff) unknown or disabled emails see the same page but get no
 * code, so the form never reveals which accounts exist.
 */
public class EmailOtpAuthenticator implements Authenticator {

	static final String EMAIL_FORM = "fullstar-email.ftl";

	static final String CODE_FORM = "fullstar-email-code.ftl";

	static final String EMAIL_TEMPLATE = "fullstar-email-code.ftl";

	static final String NOTE_EMAIL = "fullstar.otp.email";

	/** Set when the email may receive a code (existing enabled user, or sign-up allowed). */
	static final String NOTE_DELIVERABLE = "fullstar.otp.deliverable";

	private static final Logger log = Logger.getLogger(EmailOtpAuthenticator.class);

	private static final Pattern EMAIL = Pattern.compile("^[^@\\s]{1,64}@[^@\\s]{1,190}\\.[^@\\s]{2,63}$");

	private final Clock clock;

	public EmailOtpAuthenticator(Clock clock) {
		this.clock = clock;
	}

	@Override
	public void authenticate(AuthenticationFlowContext context) {
		UserModel known = context.getUser();
		if (known != null && known.getEmail() != null) {
			startChallenge(context, known.getEmail());
			return;
		}
		context.challenge(emailForm(context, null));
	}

	@Override
	public void action(AuthenticationFlowContext context) {
		MultivaluedMap<String, String> form = context.getHttpRequest().getDecodedFormParameters();
		if (form.containsKey("restart")) {
			clear(context.getAuthenticationSession());
			context.challenge(emailForm(context, null));
		}
		else if (form.containsKey("email")) {
			submitEmail(context, form.getFirst("email"));
		}
		else if (form.containsKey("resend")) {
			resend(context);
		}
		else {
			submitCode(context, form.getFirst("code"));
		}
	}

	private void submitEmail(AuthenticationFlowContext context, String raw) {
		String email = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
		if (!EMAIL.matcher(email).matches()) {
			context.challenge(emailForm(context, "fullstarInvalidEmail"));
			return;
		}
		startChallenge(context, email);
	}

	private void startChallenge(AuthenticationFlowContext context, String email) {
		AuthenticationSessionModel session = context.getAuthenticationSession();
		clear(session);
		session.setAuthNote(NOTE_EMAIL, email);
		UserModel user = findUser(context, email);
		boolean deliverable = user != null ? user.isEnabled() : allowUserCreation(context);
		session.setAuthNote(NOTE_DELIVERABLE, String.valueOf(deliverable));
		issueAndSend(context, email, deliverable);
		context.challenge(codeForm(context, email, null, "fullstarCodeSent"));
	}

	private void resend(AuthenticationFlowContext context) {
		AuthenticationSessionModel session = context.getAuthenticationSession();
		String email = session.getAuthNote(NOTE_EMAIL);
		OtpChallenge current = OtpChallenge.fromNotes(notes(session));
		if (email == null || current == null) {
			context.challenge(emailForm(context, null));
			return;
		}
		Instant now = clock.instant();
		if (!current.canResend(now)) {
			context.challenge(codeForm(context, email, "fullstarResendWait", null, current.secondsUntilResend(now)));
			return;
		}
		issueAndSend(context, email, Boolean.parseBoolean(session.getAuthNote(NOTE_DELIVERABLE)));
		context.challenge(codeForm(context, email, null, "fullstarCodeSent"));
	}

	private void submitCode(AuthenticationFlowContext context, String code) {
		AuthenticationSessionModel session = context.getAuthenticationSession();
		String email = session.getAuthNote(NOTE_EMAIL);
		OtpChallenge challenge = OtpChallenge.fromNotes(notes(session));
		if (email == null || challenge == null) {
			context.challenge(emailForm(context, null));
			return;
		}
		boolean deliverable = Boolean.parseBoolean(session.getAuthNote(NOTE_DELIVERABLE));
		OtpChallenge.Result result = challenge.verify(code, clock.instant());
		store(session, result.challenge());
		UserModel user = findUser(context, email);

		if (result.verdict() == OtpChallenge.Verdict.ACCEPTED && deliverable) {
			if (user == null) {
				user = createUser(context, email);
			}
			if (user == null || !user.isEnabled()) {
				failWrongCode(context, email, user, result.challenge());
				return;
			}
			clear(session);
			context.setUser(user);
			context.success();
			return;
		}
		switch (result.verdict()) {
			case EXPIRED -> context.failureChallenge(AuthenticationFlowError.EXPIRED_CODE,
					codeForm(context, email, "fullstarCodeExpired", null));
			case LOCKED -> {
				if (user != null) {
					context.getEvent().user(user);
				}
				context.getEvent().error(Errors.INVALID_USER_CREDENTIALS);
				context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS,
						codeForm(context, email, "fullstarTooManyAttempts", null));
			}
			default -> failWrongCode(context, email, user, result.challenge());
		}
	}

	private void failWrongCode(AuthenticationFlowContext context, String email, UserModel user, OtpChallenge challenge) {
		if (user != null) {
			// Lets Keycloak brute-force detection count the failure for this account
			context.setUser(user);
		}
		context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS,
				codeForm(context, email, "fullstarWrongCode", null, challenge.attemptsLeft()));
	}

	private void issueAndSend(AuthenticationFlowContext context, String email, boolean deliverable) {
		OtpChallenge.Issued issued = OtpChallenge.issue(clock.instant());
		store(context.getAuthenticationSession(), issued.challenge());
		if (!deliverable) {
			return;
		}
		UserModel recipient = findUser(context, email);
		if (recipient == null) {
			// Email templating needs a user; a transient one (never stored) for an email without an account
			recipient = new LightweightUserAdapter(context.getSession(), context.getRealm(), UUID.randomUUID().toString());
			recipient.setEmail(email);
		}
		Map<String, Object> attributes = new HashMap<>();
		attributes.put("code", issued.code());
		attributes.put("validMinutes", OtpChallenge.VALIDITY.toMinutes());
		try {
			context.getSession()
				.getProvider(EmailTemplateProvider.class)
				.setRealm(context.getRealm())
				.setAuthenticationSession(context.getAuthenticationSession())
				.setUser(recipient)
				.send("fullstarEmailCodeSubject", List.of(), EMAIL_TEMPLATE, attributes, email);
		}
		catch (EmailException ex) {
			// Cause chain without email addresses or the code
			log.warn("Could not send the sign-in code email: " + describe(ex));
		}
	}

	private static String describe(Throwable failure) {
		StringBuilder out = new StringBuilder();
		for (Throwable t = failure; t != null && out.length() < 600; t = t.getCause()) {
			if (!out.isEmpty()) {
				out.append(" <- ");
			}
			out.append(t.getClass().getSimpleName());
			if (t.getMessage() != null) {
				out.append(": ").append(t.getMessage().replaceAll("[^\\s<>\"']+@[^\\s<>\"']+", "<address>"));
			}
			if (t.getCause() == t) {
				break;
			}
		}
		return out.toString();
	}

	private UserModel createUser(AuthenticationFlowContext context, String email) {
		KeycloakSession session = context.getSession();
		RealmModel realm = context.getRealm();
		UserModel user = session.users().addUser(realm, email);
		user.setEmail(email);
		user.setEmailVerified(true);
		user.setEnabled(true);
		return user;
	}

	private static UserModel findUser(AuthenticationFlowContext context, String email) {
		return context.getSession().users().getUserByEmail(context.getRealm(), email);
	}

	private static boolean allowUserCreation(AuthenticationFlowContext context) {
		AuthenticatorConfigModel config = context.getAuthenticatorConfig();
		return config != null && config.getConfig() != null
				&& Boolean.parseBoolean(config.getConfig().get(EmailOtpAuthenticatorFactory.CONFIG_ALLOW_USER_CREATION));
	}

	private Response emailForm(AuthenticationFlowContext context, String error) {
		var form = context.form();
		if (error != null) {
			form.setError(error);
		}
		return form.createForm(EMAIL_FORM);
	}

	private Response codeForm(AuthenticationFlowContext context, String email, String error, String info,
			Object... errorParameters) {
		var form = context.form().setAttribute("otpEmail", email).setAttribute("codeLength", OtpChallenge.DIGITS);
		if (error != null) {
			form.setError(error, errorParameters);
		}
		if (info != null) {
			form.setInfo(info, email);
		}
		return form.createForm(CODE_FORM);
	}

	private static Map<String, String> notes(AuthenticationSessionModel session) {
		Map<String, String> notes = new HashMap<>();
		for (String name : OtpChallenge.noteNames()) {
			String value = session.getAuthNote(name);
			if (value != null) {
				notes.put(name, value);
			}
		}
		return notes;
	}

	private static void store(AuthenticationSessionModel session, OtpChallenge challenge) {
		challenge.toNotes().forEach(session::setAuthNote);
	}

	private static void clear(AuthenticationSessionModel session) {
		for (String name : OtpChallenge.noteNames()) {
			session.removeAuthNote(name);
		}
		session.removeAuthNote(NOTE_EMAIL);
		session.removeAuthNote(NOTE_DELIVERABLE);
	}

	@Override
	public boolean requiresUser() {
		return false;
	}

	@Override
	public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
		return true;
	}

	@Override
	public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
		// Nothing to set up: the email address is the factor.
	}

	@Override
	public void close() {
		// No resources
	}

}
