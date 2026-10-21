package com.fullstar.api.family.parent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Setup screens B1-B4: first PIN with grant, children (max 2) and settings (Schema §11). */
class SetupFlowTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final String CHILD = "{\"first_name\": \"Mia\", \"age\": 7, \"class_level\": 2, \"avatar_key\": \"cat\"}";

	private record Parent(String bearer, UUID familyId, String grant) {
	}

	/** Signs up and sets the first PIN; the grant comes from POST /family/pin. */
	private Parent setUp() throws Exception {
		String bearer = TestTokens.token().subject(UUID.randomUUID().toString()).bearer();
		MvcResult me = mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}"))
			.andExpect(status().isCreated())
			.andReturn();
		UUID familyId = UUID.fromString(body(me).path("family").path("id").asString());
		MvcResult pin = mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}"))
			.andExpect(status().isCreated())
			.andExpect(header().string("Cache-Control", "no-store"))
			.andExpect(jsonPath("$.data.pin_set").value(true))
			.andExpect(jsonPath("$.data.expires_in").value(900))
			.andReturn();
		return new Parent(bearer, familyId, body(pin).path("parent_grant").asString());
	}

	private static JsonNode body(MvcResult result) throws Exception {
		return JSON.readTree(result.getResponse().getContentAsString()).path("data");
	}

	private ResultActions addChild(Parent parent, String grant, String json, String key) throws Exception {
		MockHttpServletRequestBuilder request = post("/api/v1/family/parent/children")
			.header(HttpHeaders.AUTHORIZATION, parent.bearer())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json);
		if (grant != null) {
			request.header("X-Parent-Grant", grant);
		}
		if (key != null) {
			request.header("Idempotency-Key", key);
		}
		return mvc.perform(request);
	}

	private ResultActions patchSettings(Parent parent, String json) throws Exception {
		return mvc.perform(patch("/api/v1/family/parent/settings").header(HttpHeaders.AUTHORIZATION, parent.bearer())
			.header("X-Parent-Grant", parent.grant())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private ResultActions getSettings(Parent parent) throws Exception {
		return mvc.perform(get("/api/v1/family/parent/settings").header(HttpHeaders.AUTHORIZATION, parent.bearer())
			.header("X-Parent-Grant", parent.grant()));
	}

	@Test
	void firstPinReturnsAGrantThatOpensParentMode() throws Exception {
		Parent parent = setUp();
		getSettings(parent).andExpect(status().isOk())
			.andExpect(header().exists("X-Parent-Grant"))
			.andExpect(jsonPath("$.data.daily_limit_minutes").value(30))
			.andExpect(jsonPath("$.data.sound_enabled").value(true))
			.andExpect(jsonPath("$.data.celebrations_enabled").value(true));
		mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, parent.bearer())
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"9999\"}")).andExpect(status().isConflict());
	}

	@Test
	void firstChildNeedsOnlyTheTokenThenTheGrantIsRequired() throws Exception {
		Parent parent = setUp();
		addChild(parent, null, CHILD, null).andExpect(status().isCreated())
			.andExpect(header().doesNotExist("X-Parent-Grant"))
			.andExpect(jsonPath("$.status").value("success"))
			.andExpect(jsonPath("$.data.id").isString())
			.andExpect(jsonPath("$.data.first_name").value("Mia"))
			.andExpect(jsonPath("$.data.age").value(7))
			.andExpect(jsonPath("$.data.class_level").value(2))
			.andExpect(jsonPath("$.data.avatar_key").value("cat"))
			.andExpect(jsonPath("$.data.stars_total").value(0));

		addChild(parent, null, CHILD, null).andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.error.code").value("PIN_REQUIRED"));
		addChild(parent, parent.grant(), CHILD.replace("Mia", "Leo"), null).andExpect(status().isCreated());
		addChild(parent, parent.grant(), CHILD.replace("Mia", "Zoe"), null).andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("MAX_CHILDREN"));

		mvc.perform(get("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, parent.bearer()))
			.andExpect(jsonPath("$.data.children", hasSize(2)));
	}

	@Test
	void theTokenOnlyExceptionDoesNotCoverOtherParentEndpoints() throws Exception {
		Parent parent = setUp();
		mvc.perform(get("/api/v1/family/parent/settings").header(HttpHeaders.AUTHORIZATION, parent.bearer()))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.error.code").value("PIN_REQUIRED"));
	}

	@Test
	void childValidationReportsEachField() throws Exception {
		Parent parent = setUp();
		addChild(parent, null, "{}", null).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.error.fields.first_name").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields.age").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields.class_level").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields.avatar_key").value("REQUIRED"));
		addChild(parent, null, "{\"first_name\": \"A\", \"age\": 3, \"class_level\": 6, \"avatar_key\": \"cat\"}", null)
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.age").value("OUT_OF_RANGE"))
			.andExpect(jsonPath("$.error.fields.class_level").value("OUT_OF_RANGE"));
		addChild(parent, null, CHILD.replace("Mia", "   "), null).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.first_name").value("REQUIRED"));
		addChild(parent, null, CHILD.replace("Mia", "x".repeat(41)), null).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.first_name").value("INVALID_LENGTH"));
		addChild(parent, null, CHILD.replace("cat", "dragon"), null).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.avatar_key").value("INVALID"));
		Long count = systemQuery("SELECT count(*) FROM app.children WHERE family_id = ?", parent.familyId());
		assertThat(count).isZero();
	}

	@Test
	void theNameIsTrimmed() throws Exception {
		Parent parent = setUp();
		addChild(parent, null, CHILD.replace("Mia", "  Mia  "), null).andExpect(status().isCreated())
			.andExpect(jsonPath("$.data.first_name").value("Mia"));
	}

	@Test
	void aRetriedChildPostWithTheSameKeyReturnsTheFirstResult() throws Exception {
		Parent parent = setUp();
		String key = UUID.randomUUID().toString();
		MvcResult first = addChild(parent, null, CHILD, key).andExpect(status().isCreated())
			.andExpect(header().doesNotExist("Idempotent-Replayed"))
			.andReturn();
		MvcResult retry = addChild(parent, null, CHILD, key).andExpect(status().isCreated())
			.andExpect(header().string("Idempotent-Replayed", "true"))
			.andReturn();
		assertThat(body(retry).path("id").asString()).isEqualTo(body(first).path("id").asString());
		Long count = systemQuery("SELECT count(*) FROM app.children WHERE family_id = ?", parent.familyId());
		assertThat(count).isEqualTo(1L);
	}

	@Test
	void settingsPatchIsPartialAndValidated() throws Exception {
		Parent parent = setUp();
		patchSettings(parent, "{}").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.daily_limit_minutes").value(30));
		patchSettings(parent, "{\"daily_limit_minutes\": 45}").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.daily_limit_minutes").value(45))
			.andExpect(jsonPath("$.data.sound_enabled").value(true));
		patchSettings(parent, "{\"sound_enabled\": false}").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.daily_limit_minutes").value(45))
			.andExpect(jsonPath("$.data.sound_enabled").value(false))
			.andExpect(jsonPath("$.data.celebrations_enabled").value(true));
		patchSettings(parent, "{\"celebrations_enabled\": false}").andExpect(status().isOk());
		getSettings(parent).andExpect(jsonPath("$.data.daily_limit_minutes").value(45))
			.andExpect(jsonPath("$.data.sound_enabled").value(false))
			.andExpect(jsonPath("$.data.celebrations_enabled").value(false));

		patchSettings(parent, "{\"daily_limit_minutes\": 25}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.error.fields.daily_limit_minutes").value("INVALID"));
		patchSettings(parent, "{\"daily_limit_minutes\": null}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.daily_limit_minutes").value("REQUIRED"));
		patchSettings(parent, "{\"sound_enabled\": null}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.sound_enabled").value("REQUIRED"));
		patchSettings(parent, "{\"sound_enabled\": \"yes\"}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.sound_enabled").value("INVALID"));
		getSettings(parent).andExpect(jsonPath("$.data.daily_limit_minutes").value(45));
	}

	@Test
	void anotherFamilyCannotSeeOrChangeThisOne() throws Exception {
		Parent parent = setUp();
		Parent other = setUp();
		patchSettings(parent, "{\"daily_limit_minutes\": 60}").andExpect(status().isOk());
		addChild(parent, null, CHILD, null).andExpect(status().isCreated());

		getSettings(other).andExpect(jsonPath("$.data.daily_limit_minutes").value(30));
		mvc.perform(get("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, other.bearer()))
			.andExpect(jsonPath("$.data.children", hasSize(0)));
		// The other family is still on its own first child, so the token-only exception applies to it alone
		addChild(other, null, CHILD, null).andExpect(status().isCreated());
		// A grant of one family never opens the other
		addChild(parent, other.grant(), CHILD, null).andExpect(status().isUnauthorized());
	}

}
