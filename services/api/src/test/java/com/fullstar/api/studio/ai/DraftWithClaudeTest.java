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
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;

/** Plan 4.3 with FEATURE_AI_DRAFTS=true: one Claude draft per content type, with a mocked client. */
@TestPropertySource(properties = "fullstar.ai.drafts=true")
class DraftWithClaudeTest extends StudioTestSupport {

	@Autowired
	private FakeClaude claude;

	private UUID topicId;

	@BeforeEach
	void setUp() {
		asStaff("content_admin");
		topicId = newTopic("evs");
		claude.reset();
	}

	private JsonNode draft(String type) throws Exception {
		return data(send(post("/api/v1/studio/ai/drafts"), """
				{ "type": "%s", "class_level": 3, "subject": "evs", "topic_id": "%s", "count": 2 }"""
			.formatted(type, topicId)).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.source").value("claude"))
			.andReturn());
	}

	@Test
	void eachContentTypeIsDraftedFromThePrompt() throws Exception {
		claude.reply("{ \"title\": \"Nests\", \"body\": " + ContentSamples.LESSON + " }");
		assertThat(draft("lesson").path("items").get(0).path("errors").isEmpty()).isTrue();
		assertThat(claude.calls().get(0).user()).contains("animated lesson for Class 3 EVS");
		assertThat(claude.calls().get(0).system()).contains("FullStar");

		claude.reply("""
				{ "questions": [ { "title": "Nouns", "question_type": "mcq", "body": %s, "solution": %s },
				                 { "title": "Cat", "question_type": "fill_blank", "body": %s, "solution": %s } ] }"""
			.formatted(ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION, ContentSamples.FILL_BLANK,
					ContentSamples.FILL_BLANK_SOLUTION));
		JsonNode bank = draft("question_bank");
		assertThat(bank.path("items").size()).isEqualTo(2);
		assertThat(claude.calls().get(1).user()).contains("Write 2 practice questions");

		claude.reply("{ \"title\": \"Kite\", \"body\": " + ContentSamples.PASSAGE + " }");
		assertThat(draft("passage").path("items").get(0).path("kind").asString()).isEqualTo("passage");

		fetch("/api/v1/studio/me").andExpect(jsonPath("$.data.features.ai_drafts").value(true));
	}

	@Test
	void aReplyThatIsNotJsonIsReportedAsUnavailable() throws Exception {
		claude.reply("Sorry, I can't help with that.");
		send(post("/api/v1/studio/ai/drafts"), """
				{ "type": "lesson", "class_level": 3, "subject": "evs", "topic_id": "%s" }""".formatted(topicId))
			.andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.error.code").value("DEPENDENCY_UNAVAILABLE"));
	}

}
