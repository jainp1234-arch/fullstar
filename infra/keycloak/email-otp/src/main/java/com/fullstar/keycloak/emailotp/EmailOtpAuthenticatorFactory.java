package com.fullstar.keycloak.emailotp;

import java.time.Clock;
import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

public class EmailOtpAuthenticatorFactory implements AuthenticatorFactory {

	public static final String PROVIDER_ID = "fullstar-email-otp";

	public static final String CONFIG_ALLOW_USER_CREATION = "allowUserCreation";

	private static final AuthenticationExecutionModel.Requirement[] REQUIREMENTS = {
			AuthenticationExecutionModel.Requirement.REQUIRED, AuthenticationExecutionModel.Requirement.ALTERNATIVE,
			AuthenticationExecutionModel.Requirement.DISABLED };

	private static final EmailOtpAuthenticator INSTANCE = new EmailOtpAuthenticator(Clock.systemUTC());

	@Override
	public String getId() {
		return PROVIDER_ID;
	}

	@Override
	public String getDisplayType() {
		return "FullStar email code";
	}

	@Override
	public String getReferenceCategory() {
		return "otp";
	}

	@Override
	public boolean isConfigurable() {
		return true;
	}

	@Override
	public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
		return REQUIREMENTS;
	}

	@Override
	public boolean isUserSetupAllowed() {
		return false;
	}

	@Override
	public String getHelpText() {
		return "Asks for an email address and signs in with a 6-digit code sent to it (10 minutes, 5 tries).";
	}

	@Override
	public List<ProviderConfigProperty> getConfigProperties() {
		ProviderConfigProperty allowCreation = new ProviderConfigProperty();
		allowCreation.setName(CONFIG_ALLOW_USER_CREATION);
		allowCreation.setLabel("Create accounts");
		allowCreation.setType(ProviderConfigProperty.BOOLEAN_TYPE);
		allowCreation.setDefaultValue("false");
		allowCreation.setHelpText("Parents: create the account after the code is proven. Staff: off.");
		return List.of(allowCreation);
	}

	@Override
	public Authenticator create(KeycloakSession session) {
		return INSTANCE;
	}

	@Override
	public void init(Config.Scope config) {
		// No settings
	}

	@Override
	public void postInit(KeycloakSessionFactory factory) {
		// Nothing to do
	}

	@Override
	public void close() {
		// No resources
	}

}
