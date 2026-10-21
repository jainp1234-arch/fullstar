package com.fullstar.api.common.keycloak;

import com.fullstar.api.common.db.RequestActor.StaffRole;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.resilience.Dependency;
import com.fullstar.api.common.resilience.ResilientCalls;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;

/**
 * Keycloak Admin REST API as the fullstar-api-admin service account (client credentials). Every
 * call goes through {@link ResilientCalls} as the keycloak dependency.
 */
@Component
public class KeycloakAdminClient implements KeycloakAdmin {

	private static final Logger log = LoggerFactory.getLogger(KeycloakAdminClient.class);

	static final String CONFIGURE_TOTP = "CONFIGURE_TOTP";

	private static final Set<String> STAFF_ROLES = Set.of(StaffRole.CONTENT_ADMIN.dbValue(),
			StaffRole.SUPER_ADMIN.dbValue());

	/** A token is renewed this long before Keycloak says it expires. */
	private static final Duration TOKEN_MARGIN = Duration.ofSeconds(30);

	private final KeycloakAdminProperties properties;

	private final ResilientCalls calls;

	private final RestClient http;

	private final AtomicReference<AccessToken> token = new AtomicReference<>();

	private record AccessToken(String value, Instant renewAt) {
	}

	public KeycloakAdminClient(KeycloakAdminProperties properties, ResilientCalls calls) {
		this.properties = properties;
		this.calls = calls;
		JdkClientHttpRequestFactory requests = new JdkClientHttpRequestFactory(
				HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
		requests.setReadTimeout(Duration.ofSeconds(5));
		this.http = RestClient.builder().baseUrl(properties.baseUrl()).requestFactory(requests).build();
	}

	@Override
	public String ensureUser(String email) {
		requireConfigured();
		String normalized = email.strip().toLowerCase(Locale.ROOT);
		return calls.call(Dependency.KEYCLOAK, () -> authorized(() -> {
			String found = findUser(normalized);
			if (found != null) {
				return found;
			}
			try {
				URI location = http.post()
					.uri("/admin/realms/{realm}/users", properties.realm())
					.headers(this::bearer)
					.contentType(MediaType.APPLICATION_JSON)
					.body(Map.of("username", normalized, "email", normalized, "enabled", true, "requiredActions",
							List.of(CONFIGURE_TOTP)))
					.retrieve()
					.toBodilessEntity()
					.getHeaders()
					.getLocation();
				String id = lastSegment(location);
				log.info("Keycloak staff user created keycloakUserId={}", id);
				return id;
			}
			catch (HttpClientErrorException.Conflict ex) {
				// A retried create that already went through, or created at the same moment
				String again = findUser(normalized);
				if (again != null) {
					return again;
				}
				throw ex;
			}
		}));
	}

	@Override
	public void setStaffRole(String keycloakUserId, StaffRole role) {
		requireConfigured();
		calls.call(Dependency.KEYCLOAK, () -> authorized(() -> {
			String target = role == null ? null : role.dbValue();
			List<JsonNode> remove = new ArrayList<>();
			boolean hasTarget = false;
			for (JsonNode mapped : roles("/admin/realms/{realm}/users/{id}/role-mappings/realm", keycloakUserId)) {
				String name = mapped.path("name").asString();
				if (name.equals(target)) {
					hasTarget = true;
				}
				else if (STAFF_ROLES.contains(name)) {
					remove.add(mapped);
				}
			}
			if (!remove.isEmpty()) {
				http.method(HttpMethod.DELETE)
					.uri("/admin/realms/{realm}/users/{id}/role-mappings/realm", properties.realm(), keycloakUserId)
					.headers(this::bearer)
					.contentType(MediaType.APPLICATION_JSON)
					.body(remove)
					.retrieve()
					.toBodilessEntity();
			}
			if (target != null && !hasTarget) {
				JsonNode available = roles("/admin/realms/{realm}/users/{id}/role-mappings/realm/available",
						keycloakUserId)
					.stream()
					.filter(candidate -> target.equals(candidate.path("name").asString()))
					.findFirst()
					.orElseThrow(() -> new IllegalStateException("Realm role " + target + " is missing"));
				http.post()
					.uri("/admin/realms/{realm}/users/{id}/role-mappings/realm", properties.realm(), keycloakUserId)
					.headers(this::bearer)
					.contentType(MediaType.APPLICATION_JSON)
					.body(List.of(available))
					.retrieve()
					.toBodilessEntity();
			}
			log.info("Keycloak staff role set keycloakUserId={} role={}", keycloakUserId, target);
			return null;
		}));
	}

	private String findUser(String email) {
		JsonNode users = http.get()
			.uri("/admin/realms/{realm}/users?email={email}&exact=true&briefRepresentation=true", properties.realm(),
					email)
			.headers(this::bearer)
			.retrieve()
			.body(JsonNode.class);
		if (users != null) {
			for (JsonNode user : users) {
				if (email.equalsIgnoreCase(user.path("email").asString())) {
					return user.path("id").asString();
				}
			}
		}
		return null;
	}

	private List<JsonNode> roles(String path, String keycloakUserId) {
		JsonNode body = http.get()
			.uri(path, properties.realm(), keycloakUserId)
			.headers(this::bearer)
			.retrieve()
			.body(JsonNode.class);
		List<JsonNode> out = new ArrayList<>();
		if (body != null) {
			body.forEach(out::add);
		}
		return out;
	}

	/** A 401 means the cached token was revoked or expired early: drop it so the retry gets a new one. */
	private <T> T authorized(java.util.function.Supplier<T> call) {
		try {
			return call.get();
		}
		catch (HttpClientErrorException.Unauthorized ex) {
			token.set(null);
			throw ex;
		}
	}

	private void bearer(HttpHeaders headers) {
		headers.setBearerAuth(accessToken());
	}

	private String accessToken() {
		AccessToken current = token.get();
		if (current != null && Instant.now().isBefore(current.renewAt())) {
			return current.value();
		}
		MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
		form.add("grant_type", "client_credentials");
		form.add("client_id", properties.clientId());
		form.add("client_secret", properties.clientSecret());
		JsonNode response = http.post()
			.uri("/realms/{realm}/protocol/openid-connect/token", properties.realm())
			.contentType(MediaType.APPLICATION_FORM_URLENCODED)
			.body(form)
			.retrieve()
			.body(JsonNode.class);
		if (response == null || !response.path("access_token").isString()) {
			throw new IllegalStateException("Keycloak token response has no access_token");
		}
		long expiresIn = response.path("expires_in").asLong(60);
		AccessToken fresh = new AccessToken(response.path("access_token").asString(),
				Instant.now().plusSeconds(expiresIn).minus(TOKEN_MARGIN));
		token.set(fresh);
		return fresh.value();
	}

	private void requireConfigured() {
		if (!properties.configured()) {
			throw new ApiException(ErrorCode.FEATURE_DISABLED,
					"Staff management is switched off: KEYCLOAK_API_ADMIN_SECRET is not set");
		}
	}

	private static String lastSegment(URI location) {
		if (location == null) {
			throw new IllegalStateException("Keycloak did not return the new user's location");
		}
		String path = location.getPath();
		return path.substring(path.lastIndexOf('/') + 1);
	}

}
