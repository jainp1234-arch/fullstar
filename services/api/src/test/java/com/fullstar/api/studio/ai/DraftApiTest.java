package com.fullstar.api.studio.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.FakeClaude;
import com.fullstar.api.testsupport.StudioTestSupport;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

/** Plan 4.3 with AI drafts off (trial): 503 for Claude, the prompt to copy, and pasted drafts. */
class DraftApiTest extends StudioTestSupport {

	@Autowired
	private FakeClaude claude;

	private UUID topicId;

	@BeforeEach
	void setUp() {
		asStaff("content_admin");
		topicId = newTopic("evs");
		claude.reset();
	}

	private String request(String type, String pasted) throws Exception {
		return """
				{ "type": "%s", "class_level": 3, "subject": "evs", "topic_id": "%s", "count": 5 %s }"""
			.formatted(type, topicId, pasted == null ? "" : ", \"pasted\": " + JSON.writeValueAsString(pasted));
	}

	private JsonNode paste(String type, String pasted) throws Exception {
		return data(send(post("/api/v1/studio/ai/drafts"), request(type, pasted)).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.source").value("pasted"))
			.andReturn());
	}

	@Test
	void withDraftsOffClaudeIsNeverCalled() throws Exception {
		send(post("/api/v1/studio/ai/drafts"), request("lesson", null)).andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.error.code").value("FEATURE_DISABLED"));
		fetch("/api/v1/studio/me").andExpect(jsonPath("$.data.features.ai_drafts").value(false))
			.andExpect(jsonPath("$.data.features.ai_check").value(false));
		assertThat(claude.calls()).isEmpty();
	}

	@Test
	void thePromptToCopyIsFilledIn() throws Exception {
		JsonNode prompt = data(send(post("/api/v1/studio/ai/draft-prompt"), request("question_bank", null))
			.andExpect(status().isOk())
			.andReturn());
		String user = prompt.path("user").asString();
		assertThat(user).contains("Write 5 practice questions for Class 3 EVS", "in\nEnglish")
			.doesNotContain("{{");
		assertThat(prompt.path("system").asString()).contains("Reply with one JSON object only");

		UUID hindi = newTopic("hindi");
		JsonNode lesson = data(send(post("/api/v1/studio/ai/draft-prompt"), """
				{ "type": "lesson", "class_level": 3, "subject": "hindi", "topic_id": "%s" }""".formatted(hindi))
			.andReturn());
		assertThat(lesson.path("user").asString()).contains("Class 3 Hindi", "in Hindi", "subject-evs", "mascot-owl");
	}

	@Test
	void aPastedLessonIsCheckedAndNothingIsSaved() throws Exception {
		JsonNode ok = paste("lesson", "Here it is:\n```json\n{ \"title\": \"Nests\", \"difficulty\": 1, \"body\": "
				+ ContentSamples.LESSON + " }\n```");
		JsonNode item = ok.path("items").get(0);
		assertThat(item.path("kind").asString()).isEqualTo("lesson");
		assertThat(item.path("title").asString()).isEqualTo("Nests");
		assertThat(item.path("difficulty").asInt()).isEqualTo(1);
		assertThat(item.path("errors").isEmpty()).isTrue();
		Long saved = systemQuery("SELECT count(*) FROM app.content_items WHERE topic_id = ?", topicId);
		assertThat(saved).isZero();

		JsonNode bad = paste("lesson", """
				{ "body": { "scenes": [ { "id": "s1", "duration_ms": 1000, "text": "Hi" },
				  { "id": "s2", "duration_ms": 0, "quiz": { "question_item_id": "%s" } } ] } }""".formatted(UUID.randomUUID()));
		assertThat(bad.path("items").get(0).path("errors").properties()).extracting(java.util.Map.Entry::getKey)
			.containsExactlyInAnyOrder("title", "body.scenes[1].quiz.question_item_id");
	}

	@Test
	void aPastedQuestionBankReportsEachQuestion() throws Exception {
		JsonNode bank = paste("question_bank", """
				{ "questions": [
				  { "title": "Nouns", "question_type": "mcq", "difficulty": 1, "body": %s, "solution": %s },
				  { "title": "Fish", "question_type": "true_false", "body": %s, "solution": { "correct": "yes" } },
				  { "title": "Odd", "question_type": "essay", "body": {} } ] }""".formatted(ContentSamples.MCQ,
				ContentSamples.MCQ_SOLUTION, ContentSamples.TRUE_FALSE));
		JsonNode items = bank.path("items");
		assertThat(items.size()).isEqualTo(3);
		assertThat(items.get(0).path("errors").isEmpty()).isTrue();
		assertThat(items.get(0).path("question_type").asString()).isEqualTo("mcq");
		assertThat(items.get(1).path("errors").path("solution.correct").asString()).isEqualTo("INVALID");
		assertThat(items.get(1).path("errors").path("solution.explanation").asString()).isEqualTo("REQUIRED");
		assertThat(items.get(2).path("errors").path("question_type").asString()).isEqualTo("INVALID");
	}

	@Test
	void aPastedPassageGetsItsWordCountRecounted() throws Exception {
		JsonNode passage = paste("passage", """
				{ "title": "Kite", "body": { "text": "Ravi has a red kite.", "word_count": 99, "level": 1 } }""");
		JsonNode item = passage.path("items").get(0);
		assertThat(item.path("body").path("word_count").asInt()).isEqualTo(5);
		assertThat(item.path("errors").isEmpty()).isTrue();
	}

	@Test
	void unreadableOrMisplacedRequestsAreRefused() throws Exception {
		send(post("/api/v1/studio/ai/drafts"), request("lesson", "I could not write that."))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.pasted").value("INVALID_FORMAT"));
		send(post("/api/v1/studio/ai/drafts"), request("question_bank", "{ \"questions\": [] }"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.questions").value("REQUIRED"));
		send(post("/api/v1/studio/ai/drafts"), """
				{ "type": "lesson", "class_level": 4, "subject": "evs", "topic_id": "%s", "pasted": "{}" }"""
			.formatted(topicId)).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.topic_id").value("INVALID"));
		send(post("/api/v1/studio/ai/drafts"), """
				{ "type": "video", "class_level": 3, "subject": "evs", "family_chapter_id": "x" }""")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.type").value("INVALID_FORMAT"));
		send(post("/api/v1/studio/ai/drafts"), """
				{ "type": "lesson", "class_level": 3, "subject": "evs", "family_chapter_id": "%s" }"""
			.formatted(UUID.randomUUID())).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.family_chapter_id").value("INVALID"));
	}

}
