package com.fullstar.api.studio.check;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.StudioTestSupport;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** Plan 4.4: manual check (trial), accept-with-note, and publishing guarded by the database rule. */
class ContentCheckApiTest extends StudioTestSupport {

	private static final String ALL_TRUE = """
			{ "age_suitability": true, "facts_match": true, "answers_correct": true, "language": true,
			  "difficulty": true, "no_bias": true, "no_personal_info": true }""";

	private UUID topicId;

	@BeforeEach
	void setUp() {
		asStaff("content_admin");
		topicId = newTopic("evs");
	}

	/** A new MCQ; returns [item id, version id]. */
	private String[] newQuestion() throws Exception {
		JsonNode created = data(send(post("/api/v1/studio/content-items"), """
				{ "kind": "question", "question_type": "mcq", "class_level": 3, "subject": "evs", "topic_id": "%s",
				  "lang": "en", "title": "Nouns", "body": %s, "solution": %s }""".formatted(topicId, ContentSamples.MCQ,
				ContentSamples.MCQ_SOLUTION))
			.andExpect(status().isCreated())
			.andReturn());
		return new String[] { created.path("item").path("id").asString(),
				created.path("current_version").path("id").asString() };
	}

	private JsonNode manualCheck(String versionId, String flags) throws Exception {
		return data(send(post("/api/v1/studio/content-versions/" + versionId + "/manual-check"), """
				{ "checklist": %s, "flags": %s }""".formatted(ALL_TRUE, flags)).andExpect(status().isCreated())
			.andReturn());
	}

	private org.springframework.test.web.servlet.ResultActions publish(String itemId) throws Exception {
		return send(post("/api/v1/studio/content-items/" + itemId + "/publish"), "");
	}

	@Test
	void aCleanItemPublishesAfterAPassedManualCheck() throws Exception {
		String[] item = newQuestion();
		publish(item[0]).andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("CHECK_NOT_PASSED"));

		JsonNode check = manualCheck(item[1], "[]");
		assertThat(check.path("status").asString()).isEqualTo("passed");
		assertThat(check.path("model").asString()).isEqualTo("manual");
		assertThat(check.path("publishable").asBoolean()).isTrue();
		fetch("/api/v1/studio/content-items/" + item[0]).andExpect(jsonPath("$.data.item.status").value("in_check"))
			.andExpect(jsonPath("$.data.latest_check.status").value("passed"));

		publish(item[0]).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.item.status").value("published"))
			.andExpect(jsonPath("$.data.item.published_version_id").value(item[1]));
		Long audits = systemQuery("SELECT count(*) FROM app.audit_log WHERE action = 'content.publish' AND entity_id = ?",
				item[0]);
		assertThat(audits).isEqualTo(1L);

		send(post("/api/v1/studio/content-items/" + item[0] + "/unpublish"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.item.status").value("archived"));
	}

	@Test
	void anOpenCriticalFlagBlocksPublishing() throws Exception {
		String[] item = newQuestion();
		JsonNode check = manualCheck(item[1], """
				[ { "severity": "critical", "category": "wrong_answer", "location": "solution.correct",
				    "reason": "The answer is wrong." } ]""");
		assertThat(check.path("status").asString()).isEqualTo("failed");
		assertThat(check.path("critical_count").asInt()).isEqualTo(1);
		String flagId = check.path("flags").get(0).path("id").asString();
		assertThat(check.path("flags").get(0).path("location").asString()).isEqualTo("solution.correct");

		publish(item[0]).andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("CHECK_NOT_PASSED"));
		send(patch("/api/v1/studio/content-check-flags/" + flagId), """
				{ "resolution": "accepted", "note": "Looks fine to me" }""").andExpect(status().isConflict());
		String published = systemQuery("SELECT status FROM app.content_items WHERE id = ?", UUID.fromString(item[0]));
		assertThat(published).isEqualTo("in_check");
	}

	@Test
	void warningsMustBeAcceptedWithANoteBeforePublishing() throws Exception {
		String[] item = newQuestion();
		JsonNode check = manualCheck(item[1], """
				[ { "severity": "warning", "category": "difficulty", "location": "body.prompt",
				    "reason": "A little easy for Class 3." } ]""");
		assertThat(check.path("status").asString()).isEqualTo("passed");
		assertThat(check.path("publishable").asBoolean()).isFalse();
		publish(item[0]).andExpect(status().isConflict());

		String flagId = check.path("flags").get(0).path("id").asString();
		send(patch("/api/v1/studio/content-check-flags/" + flagId), """
				{ "resolution": "fixed", "note": " " }""").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.resolution").value("INVALID"))
			.andExpect(jsonPath("$.error.fields.note").value("REQUIRED"));
		send(patch("/api/v1/studio/content-check-flags/" + flagId), """
				{ "resolution": "accepted", "note": "Fine as a warm-up question." }""").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.publishable").value(true))
			.andExpect(jsonPath("$.data.flags[0].resolution").value("accepted"))
			.andExpect(jsonPath("$.data.flags[0].resolution_note").value("Fine as a warm-up question."));
		publish(item[0]).andExpect(status().isOk());
	}

	@Test
	void aNewVersionNeedsItsOwnCheckAndOldVersionsCannotBeChecked() throws Exception {
		String[] item = newQuestion();
		manualCheck(item[1], "[]");
		publish(item[0]).andExpect(status().isOk());
		JsonNode saved = data(send(post("/api/v1/studio/content-items/" + item[0] + "/versions"), """
				{ "base_version_id": "%s", "title": "Nouns 2", "body": %s, "solution": %s }""".formatted(item[1],
				ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION))
			.andExpect(status().isCreated())
			.andReturn());
		assertThat(saved.path("latest_check").isNull()).isTrue();
		assertThat(saved.path("item").path("published_version_id").asString()).isEqualTo(item[1]);

		publish(item[0]).andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("CHECK_NOT_PASSED"));
		send(post("/api/v1/studio/content-versions/" + item[1] + "/manual-check"), """
				{ "checklist": %s, "flags": [] }""".formatted(ALL_TRUE)).andExpect(status().isConflict());
	}

	@Test
	void manualChecksAreValidatedAndAnyFalseItemFails() throws Exception {
		String[] item = newQuestion();
		send(post("/api/v1/studio/content-versions/" + item[1] + "/manual-check"), """
				{ "checklist": { "age_suitability": true, "extra": true },
				  "flags": [ { "severity": "minor", "category": "spelling", "reason": "" } ] }""")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields['checklist.facts_match']").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields['checklist.extra']").value("INVALID"))
			.andExpect(jsonPath("$.error.fields['flags[0].severity']").value("INVALID"))
			.andExpect(jsonPath("$.error.fields['flags[0].category']").value("INVALID"))
			.andExpect(jsonPath("$.error.fields['flags[0].location']").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields['flags[0].reason']").value("REQUIRED"));

		JsonNode check = data(send(post("/api/v1/studio/content-versions/" + item[1] + "/manual-check"), """
				{ "checklist": %s, "flags": [] }""".formatted(ALL_TRUE.replace("\"no_bias\": true", "\"no_bias\": false")))
			.andExpect(status().isCreated())
			.andReturn());
		assertThat(check.path("status").asString()).isEqualTo("failed");
		publish(item[0]).andExpect(status().isConflict());
	}

	@Test
	void theAgentIsOffInTrial() throws Exception {
		String[] item = newQuestion();
		send(post("/api/v1/studio/content-versions/" + item[1] + "/checks"), "").andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.error.code").value("FEATURE_DISABLED"));
		fetch("/api/v1/studio/content-checks/" + UUID.randomUUID()).andExpect(status().isNotFound());
	}

}
