package com.fullstar.api.testsupport;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** A signed-in content admin and a fresh Class 3 topic, for Studio API tests. */
public abstract class StudioTestSupport extends ApiTestSupport {

	protected static final JsonMapper JSON = JsonMapper.builder().build();

	protected String bearer;

	protected UUID staffId;

	protected String asStaff(String role) {
		String subject = UUID.randomUUID().toString();
		staffId = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', ?) RETURNING id""", subject, role);
		bearer = TestTokens.token().subject(subject).audience("studio-api").roles(role).bearer();
		return bearer;
	}

	/** A topic in Class 3 of the given subject, owned by nobody else's test. */
	protected static UUID newTopic(String subject) {
		return systemQuery("""
				INSERT INTO app.topics (class_level, subject_id, name)
				SELECT 3, id, ? FROM app.subjects WHERE code = ? RETURNING id""", "Topic " + UUID.randomUUID(),
				subject);
	}

	protected ResultActions send(MockHttpServletRequestBuilder request, String json) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	protected ResultActions fetch(String path) throws Exception {
		return mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, bearer));
	}

	protected static JsonNode data(MvcResult result) throws Exception {
		return JSON.readTree(result.getResponse().getContentAsString()).path("data");
	}

}
