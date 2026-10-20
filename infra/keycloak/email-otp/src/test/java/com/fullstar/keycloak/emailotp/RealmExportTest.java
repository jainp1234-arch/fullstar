package com.fullstar.keycloak.emailotp;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.keycloak.representations.idm.AuthenticationExecutionExportRepresentation;
import org.keycloak.representations.idm.AuthenticationFlowRepresentation;
import org.keycloak.representations.idm.ClientRepresentation;
import org.keycloak.representations.idm.RealmRepresentation;
import org.keycloak.util.JsonSerialization;

/** The realm export (infra/keycloak/realm) against Schema §8.1 and §8.3. */
class RealmExportTest {

	private static RealmRepresentation realm;

	@BeforeAll
	static void load() throws IOException {
		try (InputStream in = Files.newInputStream(Path.of("../realm/fullstar-realm.json"))) {
			realm = JsonSerialization.readValue(in, RealmRepresentation.class);
		}
	}

	@Test
	void tokenLifetimesAndRotation() {
		assertThat(realm.getAccessTokenLifespan()).isEqualTo(300);
		assertThat(realm.getOfflineSessionIdleTimeout()).isEqualTo(30 * 24 * 3600);
		assertThat(realm.getRevokeRefreshToken()).isTrue();
		assertThat(realm.getRefreshTokenMaxReuse()).isZero();
	}

	@Test
	void bruteForceLocksFifteenMinutesAfterTenFailures() {
		assertThat(realm.isBruteForceProtected()).isTrue();
		assertThat(realm.isPermanentLockout()).isFalse();
		assertThat(realm.getFailureFactor()).isEqualTo(10);
		assertThat(realm.getWaitIncrementSeconds()).isEqualTo(900);
		assertThat(realm.getMaxFailureWaitSeconds()).isEqualTo(900);
	}

	@Test
	void publicClientsUsePkceAndAddTheirApiAudience() {
		for (String[] pair : List.of(new String[] { "family-app", "family-api" },
				new String[] { "content-studio", "studio-api" })) {
			ClientRepresentation client = client(pair[0]);
			assertThat(client.isPublicClient()).isTrue();
			assertThat(client.isDirectAccessGrantsEnabled()).isFalse();
			assertThat(client.isImplicitFlowEnabled()).isFalse();
			assertThat(client.getAttributes()).containsEntry("pkce.code.challenge.method", "S256");
			assertThat(client.getProtocolMappers()).anySatisfy(mapper -> {
				assertThat(mapper.getProtocolMapper()).isEqualTo("oidc-audience-mapper");
				assertThat(mapper.getConfig()).containsEntry("included.client.audience", pair[1]);
			});
			assertThat(client(pair[1]).isBearerOnly()).isTrue();
		}
	}

	@Test
	void parentsGetOfflineSessionsAndStaffEightHoursWithout() {
		assertThat(client("family-app").getDefaultClientScopes()).contains("offline_access", "basic");
		ClientRepresentation studio = client("content-studio");
		assertThat(studio.getDefaultClientScopes()).doesNotContain("offline_access").contains("roles", "basic");
		assertThat(studio.getOptionalClientScopes()).isEmpty();
		assertThat(studio.getAttributes()).containsEntry("client.session.max.lifespan", "28800")
			.containsEntry("client.session.idle.timeout", "28800");
	}

	@Test
	void parentFlowCreatesAccountsAndStaffFlowNeedsCodeAndTotpWithoutCookie() {
		assertThat(realm.getBrowserFlow()).isEqualTo("fullstar parent browser");
		assertThat(executions("fullstar parent forms")).singleElement().satisfies(e -> {
			assertThat(e.getAuthenticator()).isEqualTo(EmailOtpAuthenticatorFactory.PROVIDER_ID);
			assertThat(e.getRequirement()).isEqualTo("REQUIRED");
			assertThat(config(e.getAuthenticatorConfig())).containsEntry("allowUserCreation", "true");
		});

		String staffFlowId = flow("fullstar staff browser").getId();
		assertThat(client("content-studio").getAuthenticationFlowBindingOverrides()).containsEntry("browser", staffFlowId);
		assertThat(executions("fullstar staff browser")).noneMatch(e -> "auth-cookie".equals(e.getAuthenticator()));
		List<AuthenticationExecutionExportRepresentation> staff = executions("fullstar staff forms");
		assertThat(staff).extracting(AuthenticationExecutionExportRepresentation::getAuthenticator)
			.containsExactly(EmailOtpAuthenticatorFactory.PROVIDER_ID, "auth-otp-form");
		assertThat(staff).allMatch(e -> "REQUIRED".equals(e.getRequirement()));
		assertThat(config(staff.get(0).getAuthenticatorConfig())).containsEntry("allowUserCreation", "false");
	}

	@Test
	void staffRolesThemesAndSmtpFromEnvironment() {
		assertThat(realm.getRoles().getRealm()).extracting(r -> r.getName()).contains("content_admin", "super_admin");
		assertThat(realm.getLoginTheme()).isEqualTo("fullstar");
		assertThat(realm.getEmailTheme()).isEqualTo("fullstar");
		assertThat(realm.isRegistrationAllowed()).isFalse();
		assertThat(realm.getSmtpServer()).containsEntry("host", "${SMTP_HOST}")
			.containsEntry("password", "${SMTP_PASSWORD}")
			.containsEntry("from", "${MAIL_FROM}")
			.containsEntry("starttls", "true");
	}

	@Test
	void userProfileAsksOnlyForEmail() {
		String profile = realm.getComponents()
			.get("org.keycloak.userprofile.UserProfileProvider")
			.get(0)
			.getConfig()
			.getFirst("kc.user.profile.config");
		assertThat(profile).contains("\"email\"").doesNotContain("firstName").doesNotContain("lastName");
	}

	private static ClientRepresentation client(String clientId) {
		return realm.getClients().stream().filter(c -> clientId.equals(c.getClientId())).findFirst().orElseThrow();
	}

	private static AuthenticationFlowRepresentation flow(String alias) {
		return realm.getAuthenticationFlows().stream().filter(f -> alias.equals(f.getAlias())).findFirst().orElseThrow();
	}

	private static List<AuthenticationExecutionExportRepresentation> executions(String alias) {
		return flow(alias).getAuthenticationExecutions();
	}

	private static Map<String, String> config(String alias) {
		return realm.getAuthenticatorConfig()
			.stream()
			.filter(c -> alias.equals(c.getAlias()))
			.findFirst()
			.orElseThrow()
			.getConfig();
	}

}
