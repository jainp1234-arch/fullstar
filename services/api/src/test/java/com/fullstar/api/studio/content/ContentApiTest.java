package com.fullstar.api.studio.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.TestTokens;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Plan 4.2: topics and content items with versions (Schema §4.2, §5, §11). */
class ContentApiTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private String bearer;

	private UUID topicId;

	@BeforeEach
	void staffAndTopic() throws Exception {
		String subject = UUID.randomUUID().toString();
		systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', 'content_admin') RETURNING id""", subject);
		bearer = TestTokens.token().subject(subject).audience("studio-api").roles("content_admin").bearer();
		topicId = UUID.fromString(data(send(post("/api/v1/studio/topics"), """
				{ "class_level": 3, "subject": "evs", "name": "Water %s" }""".formatted(UUID.randomUUID()))
			.andExpect(status().isCreated())
			.andReturn()).path("id").asString());
	}

	private ResultActions send(MockHttpServletRequestBuilder request, String json) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private ResultActions fetch(String path) throws Exception {
		return mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, bearer));
	}

	private static JsonNode data(MvcResult result) throws Exception {
		return JSON.readTree(result.getResponse().getContentAsString()).path("data");
	}

	private String newItem(String kind, String type, String title, String body, String solution) {
		return """
				{ "kind": "%s", "class_level": 3, "subject": "evs", "topic_id": "%s", %s "difficulty": 2,
				  "lang": "en", "title": "%s", "body": %s %s }""".formatted(kind, topicId,
				type == null ? "" : "\"question_type\": \"" + type + "\",", title, body,
				solution == null ? "" : ", \"solution\": " + solution);
	}

	private JsonNode create(String kind, String type, String body, String solution) throws Exception {
		return data(send(post("/api/v1/studio/content-items"), newItem(kind, type, "Item", body, solution))
			.andExpect(status().isCreated())
			.andReturn());
	}

	@Test
	void everyKindAndQuestionTypeCanBeCreated() throws Exception {
		JsonNode lesson = create("lesson", null, ContentSamples.LESSON, null);
		assertThat(lesson.path("item").path("status").asString()).isEqualTo("draft");
		assertThat(lesson.path("current_version").path("version_no").asInt()).isEqualTo(1);
		assertThat(lesson.path("current_version").path("duration_seconds").asInt()).isEqualTo(15);
		assertThat(lesson.path("current_version").path("read_only").asBoolean()).isFalse();
		create("question", "mcq", ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION);
		create("question", "true_false", ContentSamples.TRUE_FALSE, ContentSamples.TRUE_FALSE_SOLUTION);
		create("question", "fill_blank", ContentSamples.FILL_BLANK, ContentSamples.FILL_BLANK_SOLUTION);
		JsonNode match = create("question", "match", ContentSamples.MATCH, ContentSamples.MATCH_SOLUTION);
		assertThat(match.path("current_version").path("solution").path("pairs").size()).isEqualTo(2);
		create("passage", null, ContentSamples.PASSAGE, null);

		fetch("/api/v1/studio/content-items?topic_id=" + topicId + "&kind=question&limit=3")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.items.length()").value(3))
			.andExpect(jsonPath("$.data.next_cursor").isString());
		fetch("/api/v1/studio/topics?class=3&subject=evs").andExpect(status().isOk())
			.andExpect(jsonPath("$.data[?(@.id == '" + topicId + "')].item_count").value(hasItem(6)));
	}

	@Test
	void savingCreatesANewVersionAndOldVersionsAreReadOnly() throws Exception {
		JsonNode created = create("question", "mcq", ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION);
		String itemId = created.path("item").path("id").asString();
		String v1 = created.path("current_version").path("id").asString();

		JsonNode saved = data(send(post("/api/v1/studio/content-items/" + itemId + "/versions"), """
				{ "base_version_id": "%s", "title": "Nouns", "body": %s, "solution": %s }""".formatted(v1,
				ContentSamples.MCQ.replace("bird", "tree"), ContentSamples.MCQ_SOLUTION))
			.andExpect(status().isCreated())
			.andReturn());
		assertThat(saved.path("current_version").path("version_no").asInt()).isEqualTo(2);
		assertThat(saved.path("item").path("title").asString()).isEqualTo("Nouns");
		assertThat(saved.path("versions").size()).isEqualTo(2);

		fetch("/api/v1/studio/content-versions/" + v1).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.version_no").value(1))
			.andExpect(jsonPath("$.data.read_only").value(true))
			.andExpect(jsonPath("$.data.body.options[1].text").value("bird"));

		// Saving on top of an old version would overwrite someone else's edit
		send(post("/api/v1/studio/content-items/" + itemId + "/versions"), """
				{ "base_version_id": "%s", "title": "Again", "body": %s, "solution": %s }""".formatted(v1,
				ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("CONFLICT"));

		Long count = systemQuery("""
				SELECT count(*) FROM app.content_versions WHERE item_id = ?""", UUID.fromString(itemId));
		assertThat(count).isEqualTo(2L);
		// And the database itself refuses to change a saved version
		assertThatThrownBy(() -> systemQuery("UPDATE app.content_versions SET title = 'x' WHERE id = ? RETURNING id",
				UUID.fromString(v1)))
			.hasMessageContaining("VERSION_IMMUTABLE");
	}

	@Test
	void invalidBodiesAreRejectedWithFieldErrorsAndNothingIsSaved() throws Exception {
		send(post("/api/v1/studio/content-items"), newItem("lesson", null, "Broken", """
				{ "scenes": [ { "id": "s1", "duration_ms": 1000, "text": "" },
				              { "id": "s2", "duration_ms": 1000, "text": "Hi", "colour": "red" } ] }""", null))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.error.fields['body.scenes[0].text']").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields['body.scenes[1].colour']").value("INVALID"));
		send(post("/api/v1/studio/content-items"), newItem("question", null, "No type", ContentSamples.MCQ,
				ContentSamples.MCQ_SOLUTION))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.question_type").value("REQUIRED"));
		send(post("/api/v1/studio/content-items"), newItem("question", "mcq", "", ContentSamples.MCQ, "null"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.title").value("REQUIRED"));
		fetch("/api/v1/studio/content-items?topic_id=" + topicId).andExpect(jsonPath("$.data.items.length()").value(0));

		JsonNode passage = create("passage", null, ContentSamples.PASSAGE, null);
		send(post("/api/v1/studio/content-items/" + passage.path("item").path("id").asString() + "/versions"), """
				{ "base_version_id": "%s", "title": "Kite", "body": { "text": "Two words", "word_count": 3, "level": 4 } }"""
			.formatted(passage.path("current_version").path("id").asString()))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields['body.level']").value("OUT_OF_RANGE"));
	}

	@Test
	void inlineQuizzesNeedAPublishedQuestion() throws Exception {
		JsonNode question = create("question", "true_false", ContentSamples.TRUE_FALSE,
				ContentSamples.TRUE_FALSE_SOLUTION);
		String questionId = question.path("item").path("id").asString();
		String lesson = """
				{ "scenes": [ { "id": "q1", "duration_ms": 0, "quiz": { "question_item_id": "%s" } } ] }"""
			.formatted(questionId);
		send(post("/api/v1/studio/content-items"), newItem("lesson", null, "Quiz", lesson, null))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields['body.scenes[0].quiz.question_item_id']").value("INVALID"));

		UUID versionId = UUID.fromString(question.path("current_version").path("id").asString());
		systemQuery("INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual') RETURNING id",
				versionId);
		systemQuery("""
				UPDATE app.content_items SET published_version_id = ?, status = 'published', published_at = now()
				 WHERE id = ? RETURNING id""", versionId, UUID.fromString(questionId));
		create("lesson", null, lesson, null);
	}

	@Test
	void topicsFormATreeWithinOneClassAndSubject() throws Exception {
		JsonNode child = data(send(post("/api/v1/studio/topics"), """
				{ "class_level": 3, "subject": "evs", "parent_id": "%s", "name": "Saving water", "sort_order": 2 }"""
			.formatted(topicId)).andExpect(status().isCreated()).andReturn());
		assertThat(child.path("parent_id").asString()).isEqualTo(topicId.toString());

		send(post("/api/v1/studio/topics"), """
				{ "class_level": 4, "subject": "evs", "parent_id": "%s", "name": "Wrong class" }""".formatted(topicId))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.parent_id").value("INVALID"));
		send(post("/api/v1/studio/topics"), """
				{ "class_level": 3, "subject": "computer", "name": "Not taught" }""")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.subject").value("INVALID"));
		send(post("/api/v1/studio/topics"), """
				{ "class_level": 3, "subject": "evs", "parent_id": "%s", "name": "Saving water" }""".formatted(topicId))
			.andExpect(status().isConflict());

		String id = child.path("id").asString();
		send(patch("/api/v1/studio/topics/" + id), """
				{ "name": "Save water", "archived": true }""").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.name").value("Save water"))
			.andExpect(jsonPath("$.data.archived").value(true));
		send(patch("/api/v1/studio/topics/" + id), """
				{ "parent_id": null, "sort_order": -1 }""").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.parent_id").value("INVALID"))
			.andExpect(jsonPath("$.error.fields.sort_order").value("OUT_OF_RANGE"));
		// Archived topics take no new content
		send(post("/api/v1/studio/content-items"), newItem("passage", null, "P", ContentSamples.PASSAGE, null)
			.replace(topicId.toString(), id))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.topic_id").value("INVALID"));
		send(patch("/api/v1/studio/topics/" + UUID.randomUUID()), "{ \"name\": \"x\" }").andExpect(status().isNotFound());
	}

	@Test
	void familiesCannotUseStudioContent() throws Exception {
		mvc.perform(get("/api/v1/studio/topics").header(HttpHeaders.AUTHORIZATION, TestTokens.token().bearer()))
			.andExpect(status().isUnauthorized());
		fetch("/api/v1/studio/content-items/" + UUID.randomUUID()).andExpect(status().isNotFound());
		fetch("/api/v1/studio/content-items?kind=video").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.kind").value("INVALID"));
		fetch("/api/v1/studio/content-items?status=archived").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.items[*].status", not(hasItem("draft"))));
	}

}
