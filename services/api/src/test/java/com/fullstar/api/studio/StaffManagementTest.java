package com.fullstar.api.studio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.FakeKeycloakAdmin;
import com.fullstar.api.testsupport.TestTokens;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.json.JsonMapper;

/** Plan 4.1: staff list and roles (super admin only), audit rows, and the S2 dashboard counts. */
class StaffManagementTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final String STAFF = "/api/v1/studio/staff";

	@Autowired
	private FakeKeycloakAdmin keycloak;

	private record Member(UUID id, String bearer) {
	}

	@AfterEach
	void keycloakUp() {
		keycloak.down(false);
	}

	private static Member member(String role) {
		String subject = UUID.randomUUID().toString();
		UUID id = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', ?) RETURNING id""", subject, role);
		return new Member(id, TestTokens.token().subject(subject).audience("studio-api").roles(role).bearer());
	}

	private ResultActions add(Member actor, String json) throws Exception {
		return mvc.perform(post(STAFF).header(HttpHeaders.AUTHORIZATION, actor.bearer())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private ResultActions change(Member actor, Object id, String json) throws Exception {
		return mvc.perform(patch(STAFF + "/" + id).header(HttpHeaders.AUTHORIZATION, actor.bearer())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private static String newEmail() {
		return "t" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
	}

	private static String addBody(String email, String role) {
		return "{\"email\": \"" + email + "\", \"display_name\": \"Asha Rao\", \"role\": \"" + role + "\"}";
	}

	private static long audits(String action, Object entityId, UUID actorId) {
		Long count = systemQuery("""
				SELECT count(*) FROM app.audit_log
				 WHERE action = ? AND entity_type = 'staff_user' AND entity_id = ? AND actor_type = 'staff'
				   AND actor_id = ?""", action, entityId.toString(), actorId.toString());
		return count;
	}

	private static UUID id(MvcResult result) throws Exception {
		return UUID.fromString(JSON.readTree(result.getResponse().getContentAsString()).path("data").path("id").asString());
	}

	@Test
	void contentAdminCannotOpenStaffPages() throws Exception {
		Member admin = member("content_admin");
		Member other = member("content_admin");
		mvc.perform(get(STAFF).header(HttpHeaders.AUTHORIZATION, admin.bearer()))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
		add(admin, addBody(newEmail(), "super_admin")).andExpect(status().isForbidden());
		change(admin, other.id(), "{\"role\": \"super_admin\"}").andExpect(status().isForbidden());
		change(admin, admin.id(), "{\"role\": \"super_admin\"}").andExpect(status().isForbidden());
		assertThat((String) systemQuery("SELECT role FROM app.staff_users WHERE id = ?", admin.id()))
			.isEqualTo("content_admin");
	}

	@Test
	void superAdminAddsStaffInKeycloakAndTheTableAndItIsAudited() throws Exception {
		Member boss = member("super_admin");
		String email = newEmail();
		MvcResult created = add(boss, addBody(email.toUpperCase(), "content_admin")).andExpect(status().isCreated())
			.andExpect(jsonPath("$.status").value("success"))
			.andExpect(jsonPath("$.data.display_name").value("Asha Rao"))
			.andExpect(jsonPath("$.data.role").value("content_admin"))
			.andExpect(jsonPath("$.data.active").value(true))
			.andReturn();
		UUID id = id(created);
		String keycloakUserId = keycloak.userId(email);
		assertThat(keycloak.role(keycloakUserId)).isEqualTo("content_admin");
		assertThat((String) systemQuery("SELECT keycloak_user_id FROM app.staff_users WHERE id = ?", id))
			.isEqualTo(keycloakUserId);
		assertThat(audits("staff.create", id, boss.id())).isEqualTo(1);
		String metadata = systemQuery("SELECT metadata::text FROM app.audit_log WHERE action = 'staff.create' AND entity_id = ?",
				id.toString());
		assertThat(metadata).doesNotContain(email).doesNotContain("Asha");

		mvc.perform(get(STAFF).header(HttpHeaders.AUTHORIZATION, boss.bearer()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data[*].id", hasItem(id.toString())));

		add(boss, addBody(email, "super_admin")).andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("CONFLICT"));
	}

	@Test
	void invalidStaffIsRejectedWithFieldErrors() throws Exception {
		Member boss = member("super_admin");
		add(boss, "{\"email\": \"not-an-email\", \"display_name\": \"\", \"role\": \"owner\"}")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.error.fields.email").value("INVALID_FORMAT"))
			.andExpect(jsonPath("$.error.fields.display_name").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields.role").value("INVALID_FORMAT"));
		Member other = member("content_admin");
		change(boss, other.id(), "{\"role\": \"owner\", \"active\": \"yes\", \"email\": \"x@example.com\"}")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.role").value("INVALID"))
			.andExpect(jsonPath("$.error.fields.active").value("INVALID"))
			.andExpect(jsonPath("$.error.fields.email").value("INVALID"));
		change(boss, UUID.randomUUID(), "{\"active\": false}").andExpect(status().isNotFound());
		change(boss, "not-a-uuid", "{\"active\": false}").andExpect(status().isNotFound());
	}

	@Test
	void roleChangesAndSwitchingOffUpdateKeycloakAndAreAudited() throws Exception {
		Member boss = member("super_admin");
		UUID id = id(add(boss, addBody(newEmail(), "content_admin")).andReturn());
		String keycloakUserId = systemQuery("SELECT keycloak_user_id FROM app.staff_users WHERE id = ?", id);

		change(boss, id, "{\"role\": \"super_admin\", \"display_name\": \"Asha R.\"}").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.role").value("super_admin"))
			.andExpect(jsonPath("$.data.display_name").value("Asha R."));
		assertThat(keycloak.role(keycloakUserId)).isEqualTo("super_admin");

		change(boss, id, "{\"active\": false}").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.active").value(false));
		assertThat(keycloak.role(keycloakUserId)).isNull();

		change(boss, id, "{\"active\": true}").andExpect(status().isOk());
		assertThat(keycloak.role(keycloakUserId)).isEqualTo("super_admin");
		assertThat(audits("staff.update", id, boss.id())).isEqualTo(3);
	}

	@Test
	void nobodyCanDemoteOrSwitchOffThemselves() throws Exception {
		Member boss = member("super_admin");
		change(boss, boss.id(), "{\"role\": \"content_admin\"}").andExpect(status().isConflict());
		change(boss, boss.id(), "{\"active\": false}").andExpect(status().isConflict());
		change(boss, boss.id(), "{\"display_name\": \"Head teacher\"}").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.display_name").value("Head teacher"));
	}

	@Test
	void keycloakDownChangesNothing() throws Exception {
		Member boss = member("super_admin");
		UUID id = id(add(boss, addBody(newEmail(), "content_admin")).andReturn());
		keycloak.down(true);
		add(boss, addBody(newEmail(), "content_admin")).andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.error.code").value("DEPENDENCY_UNAVAILABLE"));
		change(boss, id, "{\"role\": \"super_admin\"}").andExpect(status().isServiceUnavailable());
		assertThat((String) systemQuery("SELECT role FROM app.staff_users WHERE id = ?", id)).isEqualTo("content_admin");
		assertThat(audits("staff.update", id, boss.id())).isZero();
	}

	@Test
	void dashboardCountsForAnyStaff() throws Exception {
		Member admin = member("content_admin");
		long before = systemQuery("SELECT count(*) FROM app.support_tickets WHERE status = 'open'");
		UUID family = newFamily();
		systemQuery("INSERT INTO app.support_tickets (family_id, subject) VALUES (?, 'Help') RETURNING id", family);
		mvc.perform(get("/api/v1/studio/dashboard").header(HttpHeaders.AUTHORIZATION, admin.bearer()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.open_tickets").value(before + 1))
			.andExpect(jsonPath("$.data.uploads_waiting").isNumber())
			.andExpect(jsonPath("$.data.drafts").isNumber())
			.andExpect(jsonPath("$.data.recently_published").isNumber())
			.andExpect(jsonPath("$.data.open_reports").isNumber());
		mvc.perform(get("/api/v1/studio/dashboard")
			.header(HttpHeaders.AUTHORIZATION, TestTokens.token().audience("family-api").bearer()))
			.andExpect(status().isUnauthorized());
	}

}
