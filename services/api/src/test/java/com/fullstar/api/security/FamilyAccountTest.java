package com.fullstar.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * GET/POST /family/me and the parent PIN (Schema §8.1, §8.2): every 401/403/423 path, the
 * lockout and the fresh-login rule for PIN reset.
 */
class FamilyAccountTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	/** A Keycloak user with a family (created through POST /family/me). */
	private record Parent(String subject, UUID familyId) {

		String bearer() {
			return TestTokens.token().subject(subject).bearer();
		}

	}

	private Parent signUp() throws Exception {
		String subject = UUID.randomUUID().toString();
		MvcResult result = mvc.perform(post("/api/v1/family/me")
			.header(HttpHeaders.AUTHORIZATION, TestTokens.token().subject(subject).bearer())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}"))
			.andExpect(status().isCreated())
			.andReturn();
		return new Parent(subject, UUID.fromString(data(result).path("family").path("id").asString()));
	}

	private static JsonNode data(MvcResult result) throws Exception {
		return JSON.readTree(result.getResponse().getContentAsString()).path("data");
	}

	private static MockHttpServletRequestBuilder pin(MockHttpServletRequestBuilder request, String bearer, String pin) {
		return request.header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"" + pin + "\"}");
	}

	private String grant(Parent parent, String pinValue) throws Exception {
		MvcResult result = mvc.perform(pin(post("/api/v1/family/pin/verify"), parent.bearer(), pinValue))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.expires_in").value(900))
			.andReturn();
		return data(result).path("parent_grant").asString();
	}

	// ---- sign-up ----

	@Test
	void signUpCreatesTheFamilyOnceWithTheCurrentConsent() throws Exception {
		String subject = UUID.randomUUID().toString();
		String bearer = TestTokens.token().subject(subject).bearer();
		mvc.perform(get("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.error.code").value("FAMILY_NOT_FOUND"));
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"old\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.consent_version").value("INVALID"));
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.data.family.pin_set").value(false))
			.andExpect(jsonPath("$.data.family.daily_limit_minutes").value(30))
			.andExpect(jsonPath("$.data.children", hasSize(0)));
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}"))
			.andExpect(status().isConflict());
		mvc.perform(get("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.family.consent_version").value("2026-10-v1"));
		String keycloakId = systemQuery("SELECT keycloak_user_id FROM app.families WHERE keycloak_user_id = ?", subject);
		assertThat(keycloakId).isEqualTo(subject);
	}

	// ---- PIN ----

	@Test
	void firstPinIsSetOnlyOnceAndMustBeFourDigits() throws Exception {
		Parent parent = signUp();
		mvc.perform(pin(post("/api/v1/family/pin"), parent.bearer(), "12a4"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.pin").value("INVALID_FORMAT"));
		mvc.perform(pin(post("/api/v1/family/pin"), parent.bearer(), "1234")).andExpect(status().isCreated());
		mvc.perform(pin(post("/api/v1/family/pin"), parent.bearer(), "9999")).andExpect(status().isConflict());
		String hash = systemQuery("SELECT pin_hash FROM app.families WHERE id = ?", parent.familyId());
		assertThat(hash).startsWith("$2a$12$").doesNotContain("1234");
	}

	@Test
	void rightPinGivesAGrantThatOpensParentModeAndSlides() throws Exception {
		Parent parent = signUp();
		mvc.perform(pin(post("/api/v1/family/pin"), parent.bearer(), "4321")).andExpect(status().isCreated());
		String grant = grant(parent, "4321");

		mvc.perform(get("/api/v1/family/parent/test-ping").header(HttpHeaders.AUTHORIZATION, parent.bearer())
			.header("X-Parent-Grant", grant))
			.andExpect(status().isOk())
			.andExpect(header().string("X-Parent-Grant", startsWith("ey")));
	}

	@Test
	void parentModeNeedsAValidGrantForThisFamily() throws Exception {
		Parent parent = signUp();
		Parent other = signUp();
		mvc.perform(pin(post("/api/v1/family/pin"), other.bearer(), "1111")).andExpect(status().isCreated());
		String otherGrant = grant(other, "1111");

		for (String grant : new String[] { null, "garbage", otherGrant, tampered(otherGrant) }) {
			MockHttpServletRequestBuilder request = get("/api/v1/family/parent/test-ping")
				.header(HttpHeaders.AUTHORIZATION, parent.bearer());
			if (grant != null) {
				request.header("X-Parent-Grant", grant);
			}
			mvc.perform(request)
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("PIN_REQUIRED"));
		}
	}

	@Test
	void fiveWrongPinsLockForAMinute() throws Exception {
		Parent parent = signUp();
		mvc.perform(pin(post("/api/v1/family/pin"), parent.bearer(), "2468")).andExpect(status().isCreated());
		for (int i = 1; i <= 4; i++) {
			mvc.perform(pin(post("/api/v1/family/pin/verify"), parent.bearer(), "0000"))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("PIN_REQUIRED"))
				.andExpect(jsonPath("$.error.fields.pin").value("WRONG"))
				.andExpect(jsonPath("$.error.message").value("That PIN is not right. " + (5 - i) + " tries left"));
		}
		mvc.perform(pin(post("/api/v1/family/pin/verify"), parent.bearer(), "0000"))
			.andExpect(status().isLocked())
			.andExpect(jsonPath("$.error.code").value("PIN_LOCKED"))
			.andExpect(jsonPath("$.error.retry_after_s").isNumber())
			.andExpect(header().exists("Retry-After"));
		// Locked: even the right PIN waits
		mvc.perform(pin(post("/api/v1/family/pin/verify"), parent.bearer(), "2468")).andExpect(status().isLocked());

		Integer count = systemQuery("SELECT pin_failed_count::int FROM app.families WHERE id = ?", parent.familyId());
		assertThat(count).isZero();
		// The per-family PIN rate limit (5/min, Schema §10) is also used up by now
		systemQuery("UPDATE app.families SET pin_locked_until = now() - interval '1 second' WHERE id = ? RETURNING 1",
				parent.familyId());
		mvc.perform(pin(post("/api/v1/family/pin/verify"), parent.bearer(), "2468"))
			.andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
	}

	@Test
	void anExpiredLockLetsTheRightPinThrough() throws Exception {
		Parent parent = signUp();
		mvc.perform(pin(post("/api/v1/family/pin"), parent.bearer(), "2468")).andExpect(status().isCreated());
		systemQuery("UPDATE app.families SET pin_locked_until = now() - interval '1 second' WHERE id = ? RETURNING 1",
				parent.familyId());
		grant(parent, "2468");
		Object lock = systemQuery("SELECT pin_locked_until FROM app.families WHERE id = ?", parent.familyId());
		assertThat(lock).isNull();
	}

	@Test
	void pinVerifyWithoutAPinSetIsAConflict() throws Exception {
		Parent parent = signUp();
		mvc.perform(pin(post("/api/v1/family/pin/verify"), parent.bearer(), "1234")).andExpect(status().isConflict());
	}

	@Test
	void pinResetNeedsAFreshLogin() throws Exception {
		Parent parent = signUp();
		mvc.perform(pin(post("/api/v1/family/pin"), parent.bearer(), "1357")).andExpect(status().isCreated());
		systemQuery("UPDATE app.families SET pin_failed_count = 3 WHERE id = ? RETURNING 1", parent.familyId());

		String staleLogin = TestTokens.token().subject(parent.subject()).authTime(Instant.now().minusSeconds(6 * 60)).bearer();
		mvc.perform(pin(put("/api/v1/family/pin"), staleLogin, "8642"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.error.code").value("RECENT_LOGIN_REQUIRED"));

		String freshLogin = TestTokens.token().subject(parent.subject()).authTime(Instant.now().minusSeconds(30)).bearer();
		mvc.perform(pin(put("/api/v1/family/pin"), freshLogin, "8642")).andExpect(status().isOk());
		Integer count = systemQuery("SELECT pin_failed_count::int FROM app.families WHERE id = ?", parent.familyId());
		assertThat(count).isZero();
		grant(parent, "8642");
		mvc.perform(pin(post("/api/v1/family/pin/verify"), parent.bearer(), "1357")).andExpect(status().isUnauthorized());
	}

	// ---- kid mode ----

	@Test
	void kidModeNeedsAChildOfThisFamily() throws Exception {
		Parent parent = signUp();
		Parent other = signUp();
		UUID ownChild = child(parent.familyId());
		UUID otherChild = child(other.familyId());

		for (String childHeader : new String[] { null, "not-a-uuid", otherChild.toString(), UUID.randomUUID().toString() }) {
			MockHttpServletRequestBuilder request = get("/api/v1/family/kid/test-ping")
				.header(HttpHeaders.AUTHORIZATION, parent.bearer());
			if (childHeader != null) {
				request.header("X-Child-Id", childHeader);
			}
			mvc.perform(request)
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.error.code").value("CHILD_NOT_IN_FAMILY"));
		}
		mvc.perform(get("/api/v1/family/kid/test-ping").header(HttpHeaders.AUTHORIZATION, parent.bearer())
			.header("X-Child-Id", ownChild.toString()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data").value(ownChild.toString()));
	}

	@Test
	void kidAndParentModeNeedAFamily() throws Exception {
		String noFamily = TestTokens.token().bearer();
		mvc.perform(get("/api/v1/family/kid/test-ping").header(HttpHeaders.AUTHORIZATION, noFamily)
			.header("X-Child-Id", UUID.randomUUID().toString()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.error.code").value("FAMILY_NOT_FOUND"));
		mvc.perform(get("/api/v1/family/parent/test-ping").header(HttpHeaders.AUTHORIZATION, noFamily))
			.andExpect(status().isNotFound());
	}

	private static UUID child(UUID familyId) {
		return systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Kid', 8, 3, 'cat') RETURNING id""", familyId);
	}

	private static String tampered(String jwt) {
		String[] parts = jwt.split("\\.");
		String payload = new String(java.util.Base64.getUrlDecoder().decode(parts[1]));
		String changed = java.util.Base64.getUrlEncoder().withoutPadding()
			.encodeToString(payload.replace("\"exp\":", "\"exp\":9").getBytes());
		return parts[0] + "." + changed + "." + parts[2];
	}

}
