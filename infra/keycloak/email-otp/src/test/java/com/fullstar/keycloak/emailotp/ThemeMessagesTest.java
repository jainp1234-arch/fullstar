package com.fullstar.keycloak.emailotp;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.MessageFormat;
import java.util.Properties;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** Plan 7.5: the sign-in code screens say what App Flow §10 says (wrong or expired code, no email). */
class ThemeMessagesTest {

	private static final Path LOGIN = Path.of("src/main/resources/theme/fullstar/login");

	private static final Properties MESSAGES = new Properties();

	@BeforeAll
	static void load() throws IOException {
		try (InputStream in = Files.newInputStream(LOGIN.resolve("messages/messages_en.properties"))) {
			MESSAGES.load(in);
		}
	}

	/** Keycloak formats these with MessageFormat, so '' is one apostrophe. */
	private static String text(String key, Object... args) {
		return new MessageFormat(MESSAGES.getProperty(key)).format(args);
	}

	@Test
	void wrongAndExpiredCodesUseTheAppFlowWords() {
		assertThat(text("fullstarWrongCode", 4)).isEqualTo("That code didn't match. 4 tries left.");
		assertThat(text("fullstarTooManyAttempts")).startsWith("That code didn't match 5 times.").contains("Resend");
		assertThat(text("fullstarCodeExpired")).startsWith("Code expired.").contains("Resend");
		assertThat(text("fullstarResend")).isEqualTo("Resend");
	}

	@Test
	void aMissingEmailPointsToSpamResendAndChangeEmail() throws IOException {
		assertThat(text("fullstarSpamHint")).contains("Check your spam folder").contains("30 seconds");
		assertThat(text("fullstarResendWait", 12)).isEqualTo("You can resend in 12 seconds.");
		assertThat(text("fullstarOtherEmail")).isEqualTo("Change email");
		String page = Files.readString(LOGIN.resolve("fullstar-email-code.ftl"));
		assertThat(page).contains("msg(\"fullstarSpamHint\")", "label=\"fullstarResend\"", "label=\"fullstarOtherEmail\"");
	}

}
