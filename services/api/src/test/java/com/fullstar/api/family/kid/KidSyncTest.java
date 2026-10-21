package com.fullstar.api.family.kid;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.TestTokens;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** Plan 6.2: the K4 lesson with its quiz, and /family/kid/sync with server-side stars. */
class KidSyncTest extends ApiTestSupport {

	private static final int EVS = 4;

	private String bearer;

	private UUID familyId;

	private UUID childId;

	private UUID staffId;

	private UUID topicId;

	@BeforeEach
	void family() throws Exception {
		String subject = UUID.randomUUID().toString();
		bearer = TestTokens.token().subject(subject).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		familyId = systemQuery("SELECT id FROM app.families WHERE keycloak_user_id = ?", subject);
		childId = child("Asha");
		staffId = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', 'content_admin') RETURNING id""", UUID.randomUUID().toString());
		topicId = systemQuery("INSERT INTO app.topics (class_level, subject_id, name) VALUES (3, ?, ?) RETURNING id",
				EVS, "Water " + UUID.randomUUID());
	}

	private UUID child(String name) {
		return systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key, stars_total)
				VALUES (?, ?, 8, 3, 'cat', 10) RETURNING id""", familyId, name);
	}

	/** A published library item; returns {item id, version id}. */
	private UUID[] published(String kind, String body, String solution) {
		UUID itemId = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang, created_by)
				VALUES (?, 'library', 3, ?, ?, ?, 'en', ?) RETURNING id""", kind, EVS, topicId,
				"question".equals(kind) ? "mcq" : null, staffId);
		UUID versionId = systemQuery("""
				INSERT INTO app.content_versions (item_id, version_no, title, body, solution, created_by)
				VALUES (?, 1, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?) RETURNING id""", itemId, kind + " title", body,
				solution, staffId);
		systemQuery("INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual') RETURNING id",
				versionId);
		systemQuery("""
				UPDATE app.content_items SET current_version_id = ?, published_version_id = ?, status = 'published',
				       published_at = now() WHERE id = ? RETURNING id""", versionId, versionId, itemId);
		return new UUID[] { itemId, versionId };
	}

	private ResultActions sync(String key, String json) throws Exception {
		return sync(key, json, childId);
	}

	private ResultActions sync(String key, String json, UUID child) throws Exception {
		return mvc.perform(post("/api/v1/family/kid/sync").header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Child-Id", child.toString())
			.header("Idempotency-Key", key)
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private static String attempt(UUID id, UUID[] lesson, String completedAt, int correct, int total, String resume) {
		return """
				{ "id": "%s", "kind": "lesson", "subject_id": 4, "content_item_id": "%s", "content_version_id": "%s",
				  "started_at": "2026-10-22T08:00:00Z", "completed_at": %s, "correct_count": %d, "total_count": %d,
				  "duration_seconds": 120, "resume_state": %s }""".formatted(id, lesson[0], lesson[1],
				completedAt == null ? "null" : "\"" + completedAt + "\"", correct, total, resume);
	}

	@Test
	void theLessonComesWithItsQuizAndWhereTheChildLeftOff() throws Exception {
		UUID[] question = published("question", ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION);
		String body = """
				{ "scenes": [
				  { "id": "s1", "duration_ms": 4000, "text": "Rain falls.", "visual": null },
				  { "id": "q1", "duration_ms": 0, "quiz": { "question_item_id": "%s" } } ] }""".formatted(question[0]);
		UUID[] lesson = published("lesson", body, null);
		UUID attemptId = UUID.randomUUID();
		sync(UUID.randomUUID().toString(), "{ \"attempts\": [" + attempt(attemptId, lesson, null, 0, 0,
				"{\"position_s\": 4}") + "] }").andExpect(status().isOk());

		mvc.perform(get("/api/v1/family/kid/lessons/" + lesson[0]).header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Child-Id", childId.toString()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.version_id").value(lesson[1].toString()))
			.andExpect(jsonPath("$.data.body.scenes.length()").value(2))
			.andExpect(jsonPath("$.data.questions[0].id").value(question[0].toString()))
			.andExpect(jsonPath("$.data.questions[0].solution.correct[0]").exists())
			.andExpect(jsonPath("$.data.resume.attempt_id").value(attemptId.toString()))
			.andExpect(jsonPath("$.data.resume.resume_state.position_s").value(4));
	}

	@Test
	void aLessonFinishedOfflineSyncsOnceAndTheServerCountsTheStars() throws Exception {
		UUID[] question = published("question", ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION);
		UUID[] lesson = published("lesson", ContentSamples.LESSON, null);
		UUID attemptId = UUID.randomUUID();
		Instant minute = Instant.now().truncatedTo(ChronoUnit.MINUTES);
		String batch = """
				{ "attempts": [%s],
				  "answers": [
				    { "id": "%s", "attempt_id": "%s", "question_item_id": "%s", "question_version_id": "%s",
				      "is_correct": false, "answer": {"selected": ["a"]}, "answered_at": "2026-10-22T08:01:00Z" } ],
				  "minutes": ["%s", "%s"] }""".formatted(
				attempt(attemptId, lesson, "2026-10-22T08:02:00Z", 9, 10, "null"), UUID.randomUUID(), attemptId,
				question[0], question[1], minute, minute.minus(1, ChronoUnit.MINUTES));
		String key = UUID.randomUUID().toString();
		sync(key, batch).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.stars_total").value(13))
			.andExpect(jsonPath("$.data.minutes_today").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)))
			.andExpect(jsonPath("$.data.accepted.attempts").value(1))
			.andExpect(jsonPath("$.data.accepted.answers").value(1))
			.andExpect(jsonPath("$.data.accepted.minutes").value(2));
		// The same batch again (a retry) answers the same and counts nothing twice
		sync(key, batch).andExpect(status().isOk()).andExpect(jsonPath("$.data.stars_total").value(13));
		// The same events in a new batch change nothing either
		sync(UUID.randomUUID().toString(), batch).andExpect(jsonPath("$.data.stars_total").value(13));
		Long answers = systemQuery("SELECT count(*) FROM app.answer_events WHERE attempt_id = ?", attemptId);
		assertThat(answers).isEqualTo(1L);
		Long mistakes = systemQuery("SELECT count(*) FROM app.mistakes WHERE child_id = ?", childId);
		assertThat(mistakes).isEqualTo(1L);

		// Stale progress from another device never undoes the completion
		sync(UUID.randomUUID().toString(), "{ \"attempts\": [" + attempt(attemptId, lesson, null, 0, 0,
				"{\"position_s\": 2}") + "] }").andExpect(jsonPath("$.data.stars_total").value(13));
		String completed = systemQuery("SELECT completed_at::text FROM app.activity_attempts WHERE id = ?", attemptId);
		assertThat(completed).isNotNull();
		// Stars come from the counts: 0 of anything = 1, over 50% = 2
		sync(UUID.randomUUID().toString(), "{ \"attempts\": [" + attempt(UUID.randomUUID(), lesson,
				"2026-10-22T09:00:00Z", 0, 0, "null") + ", " + attempt(UUID.randomUUID(), lesson,
				"2026-10-22T09:30:00Z", 3, 5, "null") + "] }")
			.andExpect(jsonPath("$.data.stars_total").value(16));
	}

	@Test
	void eventsThatAreNotTheChildsAreSkippedNotFatal() throws Exception {
		UUID[] lesson = published("lesson", ContentSamples.LESSON, null);
		UUID sibling = child("Ravi");
		UUID attemptId = UUID.randomUUID();
		sync(UUID.randomUUID().toString(), "{ \"attempts\": [" + attempt(attemptId, lesson, "2026-10-22T08:02:00Z", 1,
				1, "null") + "] }", sibling).andExpect(status().isOk());
		// The same id from another child, an unknown lesson, a kind without a player, a future minute
		String batch = """
				{ "attempts": [%s, %s,
				    { "id": "%s", "kind": "tables", "subject_id": 3, "started_at": "2026-10-22T08:00:00Z" } ],
				  "minutes": ["%s"] }""".formatted(attempt(attemptId, lesson, "2026-10-22T08:05:00Z", 0, 1, "null"),
				attempt(UUID.randomUUID(), new UUID[] { UUID.randomUUID(), UUID.randomUUID() }, null, 0, 0, "null"),
				UUID.randomUUID(), Instant.now().plus(1, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MINUTES));
		sync(UUID.randomUUID().toString(), batch).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.accepted.attempts").value(0))
			.andExpect(jsonPath("$.data.rejected.attempts").value(3))
			.andExpect(jsonPath("$.data.rejected.minutes").value(1))
			.andExpect(jsonPath("$.data.stars_total").value(10));
		Integer siblingStars = systemQuery("SELECT stars_total FROM app.children WHERE id = ?", sibling);
		assertThat(siblingStars).isEqualTo(13);
		// Malformed events are refused as a whole
		sync(UUID.randomUUID().toString(), "{ \"attempts\": [ { \"kind\": \"lesson\" } ] }")
			.andExpect(status().isBadRequest());
	}

}
