package com.fullstar.api.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

class IdempotencyTest extends ApiTestSupport {

	private static MockHttpServletRequestBuilder event(String path, String actor, String key, String tag) {
		MockHttpServletRequestBuilder request = post(path).header(ACTOR_HEADER, actor)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"tag\": \"" + tag + "\"}");
		return key == null ? request : request.header("Idempotency-Key", key);
	}

	@Test
	void repeatedKeyReturnsTheFirstResponseWithoutWritingAgain() throws Exception {
		String actor = parent(newFamily());
		String key = UUID.randomUUID().toString();
		String tag = "idem-" + UUID.randomUUID();

		MvcResult first = mvc.perform(event("/api/v1/test/events", actor, key, tag))
			.andExpect(status().isCreated())
			.andExpect(header().doesNotExist("Idempotent-Replayed"))
			.andReturn();
		MvcResult second = mvc.perform(event("/api/v1/test/events", actor, key, tag))
			.andExpect(status().isCreated())
			.andExpect(header().string("Idempotent-Replayed", "true"))
			.andReturn();

		assertThat(second.getResponse().getContentAsString()).isEqualTo(first.getResponse().getContentAsString());
		assertThat(countUsageEvents(tag)).isEqualTo(1);
	}

	@Test
	void sameKeyOnAnotherRequestIsAConflict() throws Exception {
		String actor = parent(newFamily());
		String key = UUID.randomUUID().toString();
		String tag = "idem-" + UUID.randomUUID();
		mvc.perform(event("/api/v1/test/events", actor, key, tag)).andExpect(status().isCreated());
		mvc.perform(event("/api/v1/test/events/other", actor, key, tag))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("CONFLICT"));
		assertThat(countUsageEvents(tag)).isEqualTo(1);
	}

	@Test
	void anotherFamilyCannotReplayAResponse() throws Exception {
		String key = UUID.randomUUID().toString();
		String tag = "idem-" + UUID.randomUUID();
		mvc.perform(event("/api/v1/test/events", parent(newFamily()), key, tag)).andExpect(status().isCreated());
		mvc.perform(event("/api/v1/test/events", parent(newFamily()), key, tag))
			.andExpect(status().isConflict())
			.andExpect(header().doesNotExist("Idempotent-Replayed"));
		assertThat(countUsageEvents(tag)).isEqualTo(1);
	}

	@Test
	void failedRequestRollsBackItsWritesAndReleasesTheKey() throws Exception {
		String actor = parent(newFamily());
		String key = UUID.randomUUID().toString();
		String tag = "idem-" + UUID.randomUUID();
		mvc.perform(event("/api/v1/test/events/fail", actor, key, tag)).andExpect(status().isConflict());
		assertThat(countUsageEvents(tag)).isZero();

		mvc.perform(event("/api/v1/test/events/fail", actor, key, tag))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.message").value("Blocked after writing"));
		assertThat(countUsageEvents(tag)).isZero();
	}

	@Test
	void keyMustBeAUuid() throws Exception {
		mvc.perform(event("/api/v1/test/events", parent(newFamily()), "not-a-uuid", "x"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.error.fields['Idempotency-Key']").value("INVALID_FORMAT"));
	}

	@Test
	void withoutAKeyEveryRequestWrites() throws Exception {
		String actor = parent(newFamily());
		String tag = "idem-" + UUID.randomUUID();
		mvc.perform(event("/api/v1/test/events", actor, null, tag)).andExpect(status().isCreated());
		mvc.perform(event("/api/v1/test/events", actor, null, tag)).andExpect(status().isCreated());
		assertThat(countUsageEvents(tag)).isEqualTo(2);
	}

}
