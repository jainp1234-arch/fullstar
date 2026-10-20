package com.fullstar.api.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

/** Staff guard (Schema §8.3): active staff_users row, and the Keycloak role must match ours. */
class StaffGuardTest extends ApiTestSupport {

	private static String staff(String role, boolean active) {
		String subject = UUID.randomUUID().toString();
		systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role, active)
				VALUES (?, 'Teacher', ?, ?) RETURNING id""", subject, role, active);
		return subject;
	}

	private static String studioToken(String subject, String... roles) {
		return TestTokens.token().subject(subject).audience("studio-api").roles(roles).bearer();
	}

	@Test
	void activeStaffWithMatchingRoleSeesTheirProfile() throws Exception {
		String subject = staff("content_admin", true);
		mvc.perform(get("/api/v1/studio/me").header(HttpHeaders.AUTHORIZATION, studioToken(subject, "content_admin")))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.role").value("content_admin"))
			.andExpect(jsonPath("$.data.display_name").value("Teacher"));
	}

	@Test
	void unknownAccountIsForbidden() throws Exception {
		mvc.perform(get("/api/v1/studio/me")
			.header(HttpHeaders.AUTHORIZATION, studioToken(UUID.randomUUID().toString(), "super_admin")))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
	}

	@Test
	void inactiveStaffIsForbidden() throws Exception {
		String subject = staff("content_admin", false);
		mvc.perform(get("/api/v1/studio/me").header(HttpHeaders.AUTHORIZATION, studioToken(subject, "content_admin")))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
	}

	@Test
	void keycloakRoleMustMatchTheTableRole() throws Exception {
		String subject = staff("content_admin", true);
		for (String[] roles : new String[][] { {}, { "super_admin" } }) {
			mvc.perform(get("/api/v1/studio/me").header(HttpHeaders.AUTHORIZATION, studioToken(subject, roles)))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.error.code").value("ROLE_MISMATCH"));
		}
	}

	@Test
	void superAdminOnlyEndpoints() throws Exception {
		String admin = staff("content_admin", true);
		mvc.perform(get("/api/v1/studio/test-super-admin")
			.header(HttpHeaders.AUTHORIZATION, studioToken(admin, "content_admin")))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
		String superAdmin = staff("super_admin", true);
		mvc.perform(get("/api/v1/studio/test-super-admin")
			.header(HttpHeaders.AUTHORIZATION, studioToken(superAdmin, "super_admin")))
			.andExpect(status().isOk());
	}

	@Test
	void parentAccountWithAStudioTokenIsForbidden() throws Exception {
		// A parent can complete the staff Keycloak flow, but has no staff_users row (security review note)
		mvc.perform(get("/api/v1/studio/me")
			.header(HttpHeaders.AUTHORIZATION, studioToken(UUID.randomUUID().toString())))
			.andExpect(status().isForbidden());
	}

}
