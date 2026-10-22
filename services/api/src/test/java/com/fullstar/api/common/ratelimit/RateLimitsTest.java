package com.fullstar.api.common.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.json.JsonMapper;

/**
 * Plan 9.2: every Schema §10 per-family limit answers 429 RATE_LIMITED with Retry-After once used
 * up, for that family only. Invalid requests take a permit too, so the bodies here are minimal.
 */
class RateLimitsTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private Family family;

	private record Family(String bearer, String grant, UUID childId) {
	}

	@BeforeEach
	void setUp() throws Exception {
		family = newSignedInFamily();
	}

	private Family newSignedInFamily() throws Exception {
		String subject = UUID.randomUUID().toString();
		String bearer = TestTokens.token().subject(subject).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		MvcResult pin = mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andExpect(status().isCreated()).andReturn();
		String grant = JSON.readTree(pin.getResponse().getContentAsString()).path("data").path("parent_grant").asString();
		UUID familyId = systemQuery("SELECT id FROM app.families WHERE keycloak_user_id = ?", subject);
		UUID childId = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Asha', 8, 3, 'cat') RETURNING id""", familyId);
		return new Family(bearer, grant, childId);
	}

	private ResultActions parent(Family f, MockHttpServletRequestBuilder request, String json) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, f.bearer())
			.header("X-Parent-Grant", f.grant())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private ResultActions kid(Family f, MockHttpServletRequestBuilder request, String json) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, f.bearer())
			.header("X-Child-Id", f.childId().toString())
			.header("Idempotency-Key", UUID.randomUUID().toString())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	/** Sends the request limit times without a 429, then expects the 429. */
	private void usedUpAfter(int limit, Call call) throws Exception {
		for (int i = 0; i < limit; i++) {
			assertThat(call.send().andReturn().getResponse().getStatus()).as("request %d", i + 1).isNotEqualTo(429);
		}
		call.send()
			.andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.error.code").value("RATE_LIMITED"))
			.andExpect(header().exists(HttpHeaders.RETRY_AFTER));
	}

	@FunctionalInterface
	private interface Call {

		ResultActions send() throws Exception;

	}

	@Test
	void uploadsAre20AnHourAcrossNewUploadsAndRetakes() throws Exception {
		String book = UUID.randomUUID().toString();
		for (int i = 0; i < 10; i++) {
			parent(family, post("/api/v1/family/parent/pages/" + UUID.randomUUID() + "/retake"), "{}");
		}
		usedUpAfter(10, () -> parent(family, post("/api/v1/family/parent/books/" + book + "/uploads"), "{}"));
	}

	@Test
	void worksheetsAre30AnHour() throws Exception {
		usedUpAfter(30, () -> parent(family, post("/api/v1/family/parent/worksheets"), "{}"));
	}

	@Test
	void syncIs60AMinuteAndOtherFamiliesAreNotSlowedDown() throws Exception {
		usedUpAfter(60, () -> kid(family, post("/api/v1/family/kid/sync"), "{}"));
		Family other = newSignedInFamily();
		kid(other, post("/api/v1/family/kid/sync"), "{}").andExpect(status().isOk());
	}

	@Test
	void supportIs10ADayAcrossReportsAndTickets() throws Exception {
		for (int i = 0; i < 5; i++) {
			parent(family, post("/api/v1/family/parent/problem-reports"), "{}");
		}
		usedUpAfter(5, () -> parent(family, post("/api/v1/family/parent/support-tickets"), "{}"));
	}

}
