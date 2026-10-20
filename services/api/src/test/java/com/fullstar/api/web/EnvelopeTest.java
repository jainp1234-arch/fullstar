package com.fullstar.api.web;

import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import org.junit.jupiter.api.Test;

class EnvelopeTest extends ApiTestSupport {

	@Test
	void healthUsesTheEnvelope() throws Exception {
		mvc.perform(get("/api/v1/public/health"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("success"))
			.andExpect(jsonPath("$.error").value(nullValue()))
			.andExpect(jsonPath("$.data.liveness").value("UP"))
			.andExpect(jsonPath("$.data.readiness").value("UP"))
			.andExpect(jsonPath("$.data.database").value("UP"))
			.andExpect(header().string("X-Request-Id", matchesPattern("[0-9a-f-]{36}")));
	}

	@Test
	void configListsAvatarsSubjectsLimitsAndConsentInSnakeCase() throws Exception {
		mvc.perform(get("/api/v1/public/config"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("success"))
			.andExpect(jsonPath("$.data.avatars", hasSize(12)))
			.andExpect(jsonPath("$.data.avatars", hasItems("cat", "unicorn")))
			.andExpect(jsonPath("$.data.classes", hasSize(5)))
			.andExpect(jsonPath("$.data.classes[2].class_level").value(3))
			.andExpect(jsonPath("$.data.classes[2].subjects[*].code", hasItems("english", "hindi", "maths", "evs")))
			.andExpect(jsonPath("$.data.classes[2].subjects", hasSize(4)))
			.andExpect(jsonPath("$.data.upload_limits.pdf_max_bytes").value(52428800))
			.andExpect(jsonPath("$.data.upload_limits.pdf_max_pages").value(300))
			.andExpect(jsonPath("$.data.upload_limits.photo_max_bytes").value(10485760))
			.andExpect(jsonPath("$.data.upload_limits.photos_per_upload").value(50))
			.andExpect(jsonPath("$.data.time_limits.options_minutes", hasSize(4)))
			.andExpect(jsonPath("$.data.time_limits.default_minutes").value(30))
			.andExpect(jsonPath("$.data.consent_version").value("2026-10-v1"));
	}

	@Test
	void protectedPathsAnswerUnauthenticatedEnvelope() throws Exception {
		mvc.perform(get("/api/v1/family/me"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.status").value("error"))
			.andExpect(jsonPath("$.data").value(nullValue()))
			.andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
	}

	@Test
	void unknownPublicPathIsNotFoundEnvelope() throws Exception {
		mvc.perform(get("/api/v1/public/nothing-here"))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.status").value("error"))
			.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
	}

	@Test
	void incomingRequestIdIsKeptWhenSafe() throws Exception {
		mvc.perform(get("/api/v1/public/health").header("X-Request-Id", "abc-123"))
			.andExpect(header().string("X-Request-Id", "abc-123"));
		mvc.perform(get("/api/v1/public/health").header("X-Request-Id", "bad id\nwith newline"))
			.andExpect(header().string("X-Request-Id", matchesPattern("[0-9a-f-]{36}")));
	}

	@Test
	void apiDocsAreOffOutsideTheLocalProfile() throws Exception {
		mvc.perform(get("/v3/api-docs")).andExpect(status().isNotFound());
	}

}
