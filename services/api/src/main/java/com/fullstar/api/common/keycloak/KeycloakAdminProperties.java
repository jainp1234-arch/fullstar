package com.fullstar.api.common.keycloak;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * fullstar.keycloak-admin.*: the confidential client fullstar-api-admin (service account with
 * realm-management manage-users only) the API uses to manage staff accounts (Plan 4.1). An empty
 * secret leaves staff management switched off; every other endpoint works without it.
 */
@ConfigurationProperties("fullstar.keycloak-admin")
public record KeycloakAdminProperties(String baseUrl, String realm, String clientId, String clientSecret) {

	public KeycloakAdminProperties {
		baseUrl = baseUrl == null || baseUrl.isBlank() ? "http://localhost:8080/auth" : stripSlash(baseUrl.strip());
		realm = realm == null || realm.isBlank() ? "fullstar" : realm.strip();
		clientId = clientId == null || clientId.isBlank() ? "fullstar-api-admin" : clientId.strip();
		clientSecret = clientSecret == null || clientSecret.isBlank() ? null : clientSecret;
	}

	public boolean configured() {
		return clientSecret != null;
	}

	private static String stripSlash(String value) {
		return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
	}

	@Override
	public String toString() {
		return "KeycloakAdminProperties[baseUrl=" + baseUrl + ", realm=" + realm + ", clientId=" + clientId + "]";
	}

}
