package com.fullstar.api.common.keycloak;

import com.fullstar.api.common.db.RequestActor.StaffRole;

/**
 * Staff accounts in Keycloak (Schema §8.3): the realm role must match staff_users.role, so every
 * role change is made on both sides. Never call it from inside a database callback.
 */
public interface KeycloakAdmin {

	/**
	 * The Keycloak user id for this email; creates the user (TOTP set-up required on first sign-in)
	 * when there is none.
	 */
	String ensureUser(String email);

	/** Gives the user exactly this staff realm role; null removes both staff roles. */
	void setStaffRole(String keycloakUserId, StaffRole role);

}
