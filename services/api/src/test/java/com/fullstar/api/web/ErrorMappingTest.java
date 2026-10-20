package com.fullstar.api.web;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class ErrorMappingTest extends ApiTestSupport {

	@Test
	void invalidBodyGivesValidationFailedWithSnakeCaseFieldMap() throws Exception {
		mvc.perform(post("/api/v1/test/children").header(ACTOR_HEADER, parent(newFamily()))
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"first_name\": \"\", \"age\": 30}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.status").value("error"))
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.error.fields.first_name").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields.age").value("OUT_OF_RANGE"));
	}

	@Test
	void malformedJsonGivesValidationFailed() throws Exception {
		mvc.perform(post("/api/v1/test/children").header(ACTOR_HEADER, parent(newFamily()))
			.contentType(MediaType.APPLICATION_JSON)
			.content("{not json"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
	}

	@Test
	void databaseRuleViolationMapsToItsErrorCode() throws Exception {
		UUID family = newFamily();
		for (int i = 0; i < 2; i++) {
			mvc.perform(post("/api/v1/test/children").header(ACTOR_HEADER, parent(family))
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"first_name\": \"Child\", \"age\": 7}"))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.status").value("success"));
		}
		mvc.perform(post("/api/v1/test/children").header(ACTOR_HEADER, parent(family))
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"first_name\": \"Third\", \"age\": 7}"))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("MAX_CHILDREN"))
			.andExpect(jsonPath("$.error.message").value("A family can have at most two children"));
	}

	@Test
	void rlsViolationIsForbidden() throws Exception {
		// Anonymous: app.current_family() is NULL, so the row fails the RLS WITH CHECK
		mvc.perform(post("/api/v1/test/children").contentType(MediaType.APPLICATION_JSON)
			.content("{\"first_name\": \"Child\", \"age\": 7}"))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
	}

	@Test
	void unexpectedErrorsHideDetails() throws Exception {
		mvc.perform(get("/api/v1/test/boom"))
			.andExpect(status().isInternalServerError())
			.andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"))
			.andExpect(content().string(not(containsString("internal detail"))))
			.andExpect(content().string(not(containsString("IllegalStateException"))));
	}

	@Test
	void notFoundUsesTheEnvelope() throws Exception {
		mvc.perform(get("/api/v1/test/missing"))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
	}

	@Test
	void rateLimitGives429WithRetryAfter() throws Exception {
		String actor = parent(newFamily());
		for (int i = 0; i < 5; i++) {
			mvc.perform(post("/api/v1/test/pin-verify").header(ACTOR_HEADER, actor)).andExpect(status().isOk());
		}
		mvc.perform(post("/api/v1/test/pin-verify").header(ACTOR_HEADER, actor))
			.andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.error.code").value("RATE_LIMITED"))
			.andExpect(jsonPath("$.error.retry_after_s").isNumber())
			.andExpect(header().exists("Retry-After"));
		// Another family has its own limit
		mvc.perform(post("/api/v1/test/pin-verify").header(ACTOR_HEADER, parent(newFamily()))).andExpect(status().isOk());
	}

}
