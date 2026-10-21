package com.fullstar.api.testsupport;

import com.fullstar.api.common.db.RequestActor.StaffRole;
import com.fullstar.api.common.error.DependencyUnavailableException;
import com.fullstar.api.common.keycloak.KeycloakAdmin;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** In-memory Keycloak accounts for the API tests: email → user id, user id → staff realm role. */
public class FakeKeycloakAdmin implements KeycloakAdmin {

	private final Map<String, String> users = new ConcurrentHashMap<>();

	private final Map<String, String> roles = new ConcurrentHashMap<>();

	private volatile boolean down;

	@Override
	public String ensureUser(String email) {
		failIfDown();
		return users.computeIfAbsent(email.strip().toLowerCase(Locale.ROOT), e -> UUID.randomUUID().toString());
	}

	@Override
	public void setStaffRole(String keycloakUserId, StaffRole role) {
		failIfDown();
		if (role == null) {
			roles.remove(keycloakUserId);
		}
		else {
			roles.put(keycloakUserId, role.dbValue());
		}
	}

	public String userId(String email) {
		return users.get(email.toLowerCase(Locale.ROOT));
	}

	/** The staff realm role, or null when the user has none. */
	public String role(String keycloakUserId) {
		return roles.get(keycloakUserId);
	}

	public void down(boolean value) {
		this.down = value;
	}

	private void failIfDown() {
		if (down) {
			throw new DependencyUnavailableException("keycloak", new IllegalStateException("down"));
		}
	}

}
