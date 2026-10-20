package com.fullstar.api.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** The app_api pool has one connection in tests, so every request reuses the same session. */
class RlsSessionTest extends ApiTestSupport {

	@Test
	void parentRequestSetsActorAndFamily() throws Exception {
		UUID family = newFamily();
		mvc.perform(get("/api/v1/test/session").header(ACTOR_HEADER, parent(family)))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.actor").value("parent"))
			.andExpect(jsonPath("$.data.family_id").value(family.toString()))
			.andExpect(jsonPath("$.data.staff_role").value(""));
	}

	@Test
	void staffRequestSetsActorAndRole() throws Exception {
		mvc.perform(get("/api/v1/test/session").header(ACTOR_HEADER, "staff:super_admin"))
			.andExpect(jsonPath("$.data.actor").value("staff"))
			.andExpect(jsonPath("$.data.family_id").value(""))
			.andExpect(jsonPath("$.data.staff_role").value("super_admin"));
	}

	@Test
	void valuesDoNotLeakToTheNextRequestOnTheSameConnection() throws Exception {
		mvc.perform(get("/api/v1/test/session").header(ACTOR_HEADER, parent(newFamily())))
			.andExpect(jsonPath("$.data.actor").value("parent"));
		mvc.perform(get("/api/v1/test/session"))
			.andExpect(jsonPath("$.data.actor").value(""))
			.andExpect(jsonPath("$.data.family_id").value(""));
	}

	@Test
	void eachFamilySeesOnlyItsOwnRows() throws Exception {
		UUID familyA = newFamily();
		UUID familyB = newFamily();
		for (UUID family : new UUID[] { familyA, familyA, familyB }) {
			mvc.perform(post("/api/v1/test/children").header(ACTOR_HEADER, parent(family))
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"first_name\": \"Kid\", \"age\": 8}"))
				.andExpect(status().isCreated());
		}
		mvc.perform(get("/api/v1/test/children/count").header(ACTOR_HEADER, parent(familyA)))
			.andExpect(jsonPath("$.data").value(2));
		mvc.perform(get("/api/v1/test/children/count").header(ACTOR_HEADER, parent(familyB)))
			.andExpect(jsonPath("$.data").value(1));
		mvc.perform(get("/api/v1/test/children/count").header(ACTOR_HEADER, "staff:super_admin"))
			.andExpect(jsonPath("$.data").value(0));
	}

}
