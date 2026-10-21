package com.fullstar.api.studio.check;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.FakeClaude;
import com.fullstar.api.testsupport.StudioTestSupport;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;

/** Plan 4.4 with FEATURE_AI_CHECK=true: the content-check job runs the agent (mocked Claude). */
@TestPropertySource(properties = "fullstar.ai.check=true")
class ContentCheckAgentTest extends StudioTestSupport {

	@Autowired
	private FakeClaude claude;

	@Autowired
	private ContentCheckAgent agent;

	private UUID topicId;

	@BeforeEach
	void setUp() {
		asStaff("content_admin");
		topicId = newTopic("evs");
		claude.reset();
	}

	private String[] newLesson() throws Exception {
		JsonNode created = data(send(post("/api/v1/studio/content-items"), """
				{ "kind": "lesson", "class_level": 3, "subject": "evs", "topic_id": "%s", "lang": "en",
				  "title": "Nests", "body": %s }""".formatted(topicId, ContentSamples.LESSON))
			.andExpect(status().isCreated())
			.andReturn());
		return new String[] { created.path("item").path("id").asString(),
				created.path("current_version").path("id").asString() };
	}

	private JsonNode awaitFinished(String checkId) throws Exception {
		Instant until = Instant.now().plus(Duration.ofSeconds(30));
		while (Instant.now().isBefore(until)) {
			JsonNode check = data(fetch("/api/v1/studio/content-checks/" + checkId).andReturn());
			if (!"running".equals(check.path("status").asString())) {
				return check;
			}
			Thread.sleep(200);
		}
		throw new AssertionError("content check still running");
	}

	@Test
	void theJobWritesTheAgentsFlagsAndACriticalFlagBlocksPublishing() throws Exception {
		claude.reply("""
				```json
				{ "flags": [ { "severity": "critical", "category": "fact_mismatch", "location": "body.scenes[1].text",
				               "reason": "Birds also use mud." },
				             { "severity": "warning", "category": "language", "location": { "path": "title" },
				               "reason": "Title could be clearer." } ] }
				```""");
		String[] lesson = newLesson();
		JsonNode running = data(send(post("/api/v1/studio/content-versions/" + lesson[1] + "/checks"), "")
			.andExpect(status().isAccepted())
			.andExpect(jsonPath("$.data.status").value("running"))
			.andExpect(jsonPath("$.data.model").value("claude-sonnet-5-5"))
			.andReturn());
		JsonNode done = awaitFinished(running.path("id").asString());
		assertThat(done.path("status").asString()).isEqualTo("failed");
		assertThat(done.path("critical_count").asInt()).isEqualTo(1);
		assertThat(done.path("warning_count").asInt()).isEqualTo(1);
		assertThat(done.path("flags").get(0).path("location").asString()).isEqualTo("body.scenes[1].text");
		assertThat(claude.calls().get(0).user()).contains("Class 3 EVS", "\"scenes\"", "Title: Nests");
		assertThat(claude.calls().get(0).system()).contains("fact_mismatch");
		send(post("/api/v1/studio/content-items/" + lesson[0] + "/publish"), "").andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("CHECK_NOT_PASSED"));
	}

	@Test
	void aCleanReplyPassesAndTheItemPublishes() throws Exception {
		claude.reply("{ \"flags\": [] }");
		String[] lesson = newLesson();
		JsonNode running = data(send(post("/api/v1/studio/content-versions/" + lesson[1] + "/checks"), "")
			.andExpect(status().isAccepted())
			.andReturn());
		JsonNode done = awaitFinished(running.path("id").asString());
		assertThat(done.path("status").asString()).isEqualTo("passed");
		assertThat(done.path("publishable").asBoolean()).isTrue();
		send(post("/api/v1/studio/content-items/" + lesson[0] + "/publish"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.item.status").value("published"));
	}

	@Test
	void anUnreadableReplyIsRetriedThenTheCheckEndsInError() throws Exception {
		String[] lesson = newLesson();
		UUID checkId = systemQuery(
				"INSERT INTO app.content_checks (version_id, model) VALUES (?, 'claude-sonnet-5-5') RETURNING id",
				UUID.fromString(lesson[1]));
		claude.reply("I think it is fine.");
		assertThatThrownBy(() -> agent.run(checkId, checkId.toString())).isInstanceOf(IllegalStateException.class);
		String status = systemQuery("SELECT status FROM app.content_checks WHERE id = ?", checkId);
		assertThat(status).isEqualTo("running");

		agent.giveUp(checkId, "The content check could not be completed");
		JsonNode check = data(fetch("/api/v1/studio/content-checks/" + checkId).andReturn());
		assertThat(check.path("status").asString()).isEqualTo("error");
		assertThat(agent.run(checkId, checkId.toString())).isEqualTo(ContentCheckAgent.Outcome.ALREADY_DONE);
	}

}
