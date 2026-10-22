package com.fullstar.api.family.kid;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.TestTokens;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Plan 7.1: practice home, shuffled sets of 10, Fix my mistakes, tables attempts. */
class KidPracticeTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

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
		childId = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Asha', 8, 3, 'cat') RETURNING id""", familyId);
		staffId = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', 'content_admin') RETURNING id""", UUID.randomUUID().toString());
		topicId = systemQuery("INSERT INTO app.topics (class_level, subject_id, name) VALUES (3, ?, ?) RETURNING id",
				EVS, "Water " + UUID.randomUUID());
	}

	/** A published question; scope library, or of the catalog chapter given. */
	private UUID[] question(UUID catalogChapterId) {
		UUID itemId = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang,
				                               catalog_chapter_id, created_by)
				VALUES ('question', ?, 3, ?, ?, 'mcq', 'en', ?, ?) RETURNING id""",
				catalogChapterId == null ? "library" : "catalog_chapter", EVS, topicId, catalogChapterId, staffId);
		UUID versionId = systemQuery("""
				INSERT INTO app.content_versions (item_id, version_no, title, body, solution, created_by)
				VALUES (?, 1, 'Q', CAST(? AS jsonb), CAST(? AS jsonb), ?) RETURNING id""", itemId, ContentSamples.MCQ,
				ContentSamples.MCQ_SOLUTION, staffId);
		systemQuery("INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual') RETURNING id",
				versionId);
		systemQuery("""
				UPDATE app.content_items SET current_version_id = ?, published_version_id = ?, status = 'published',
				       published_at = now() WHERE id = ? RETURNING id""", versionId, versionId, itemId);
		return new UUID[] { itemId, versionId };
	}

	private ResultActions kid(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
			String json) throws Exception {
		request.header(HttpHeaders.AUTHORIZATION, bearer).header("X-Child-Id", childId.toString());
		if (json != null) {
			request.header("Idempotency-Key", UUID.randomUUID().toString())
				.contentType(MediaType.APPLICATION_JSON)
				.content(json);
		}
		return mvc.perform(request);
	}

	private JsonNode set(String json) throws Exception {
		return JSON.readTree(kid(post("/api/v1/family/kid/practice-sets"), json).andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString()).path("data");
	}

	/** One practice attempt with these answers to the question, synced as the device does. */
	private void answer(UUID[] question, boolean... correct) throws Exception {
		UUID attempt = UUID.randomUUID();
		StringBuilder answers = new StringBuilder();
		for (int i = 0; i < correct.length; i++) {
			answers.append(i == 0 ? "" : ",").append("""
					{ "id": "%s", "attempt_id": "%s", "question_item_id": "%s", "question_version_id": "%s",
					  "is_correct": %s, "answer": {"selected": ["a"]}, "answered_at": "2026-10-22T08:0%d:00Z" }"""
				.formatted(UUID.randomUUID(), attempt, question[0], question[1], correct[i], i));
		}
		kid(post("/api/v1/family/kid/sync"), """
				{ "attempts": [ { "id": "%s", "kind": "practice", "subject_id": 4, "started_at": "2026-10-22T08:00:00Z",
				                  "completed_at": "2026-10-22T08:09:00Z", "correct_count": 1, "total_count": %d } ],
				  "answers": [%s] }""".formatted(attempt, correct.length, answers)).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.accepted.attempts").value(1));
	}

	private boolean openMistake(UUID question) {
		Long open = systemQuery(
				"SELECT count(*) FROM app.mistakes WHERE child_id = ? AND question_item_id = ? AND resolved_at IS NULL",
				childId, question);
		return open == 1;
	}

	@Test
	void aSetIsTenShuffledQuestionsOfTheClassAndTheChildsOwnBook() throws Exception {
		Set<String> mine = new HashSet<>();
		for (int i = 0; i < 12; i++) {
			mine.add(question(null)[0].toString());
		}
		// Another family's prepared chapter is not this child's to practise
		UUID otherBook = systemQuery("INSERT INTO app.catalog_books (class_level, subject_id, title) VALUES (3, ?, ?) RETURNING id",
				EVS, "Other " + UUID.randomUUID());
		UUID otherChapter = systemQuery(
				"INSERT INTO app.catalog_chapters (catalog_book_id, number, title) VALUES (?, 1, 'X') RETURNING id", otherBook);
		UUID foreign = question(otherChapter)[0];

		kid(get("/api/v1/family/kid/practice"), null).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.subjects[3].code").value("evs"))
			.andExpect(jsonPath("$.data.subjects[3].questions").value(org.hamcrest.Matchers.greaterThanOrEqualTo(12)))
			.andExpect(jsonPath("$.data.subjects[3].topics[?(@.id == '" + topicId + "')].questions").value(12))
			.andExpect(jsonPath("$.data.mistakes").value(0));

		JsonNode first = set("{ \"subject_id\": 4, \"topic_id\": \"" + topicId + "\", \"kind\": \"practice\" }");
		assertThat(first.path("questions")).hasSize(10);
		Set<String> ids = new HashSet<>();
		first.path("questions").forEach(q -> ids.add(q.path("id").asString()));
		assertThat(mine).containsAll(ids);
		assertThat(ids).doesNotContain(foreign.toString());
		assertThat(first.path("questions").get(0).path("solution").path("correct").isArray()).isTrue();
		// Shuffled: across a few sets the order differs
		boolean differs = false;
		for (int i = 0; i < 5 && !differs; i++) {
			JsonNode again = set("{ \"subject_id\": 4, \"topic_id\": \"" + topicId + "\" }");
			differs = !again.path("questions").get(0).path("id").equals(first.path("questions").get(0).path("id"))
					|| !again.path("questions").get(1).path("id").equals(first.path("questions").get(1).path("id"));
		}
		assertThat(differs).isTrue();
		kid(post("/api/v1/family/kid/practice-sets"), "{ \"subject_id\": 5 }").andExpect(status().isNotFound());
	}

	@Test
	void aQuestionLeavesMistakesAfterTwoRightAnswersInARow() throws Exception {
		UUID[] q = question(null);
		answer(q, false);
		assertThat(openMistake(q[0])).isTrue();
		kid(get("/api/v1/family/kid/mistakes"), null).andExpect(jsonPath("$.data.questions[0].id").value(q[0].toString()));

		// Right, then wrong again: still a mistake; then right twice in a row: fixed
		answer(q, true, false);
		assertThat(openMistake(q[0])).isTrue();
		answer(q, true);
		assertThat(openMistake(q[0])).isTrue();
		answer(q, true);
		assertThat(openMistake(q[0])).isFalse();
		kid(get("/api/v1/family/kid/mistakes"), null).andExpect(jsonPath("$.data.questions.length()").value(0));
		kid(get("/api/v1/family/kid/practice"), null).andExpect(jsonPath("$.data.mistakes").value(0));
	}

	@Test
	void tablesAndTheChallengeCountAsAttemptsWithStars() throws Exception {
		kid(post("/api/v1/family/kid/sync"), """
				{ "attempts": [
				  { "id": "%s", "kind": "tables", "subject_id": 3, "started_at": "2026-10-22T08:00:00Z",
				    "completed_at": "2026-10-22T08:02:00Z", "correct_count": 9, "total_count": 10,
				    "resume_state": {"table": 7} },
				  { "id": "%s", "kind": "tables_challenge", "subject_id": 3, "started_at": "2026-10-22T08:05:00Z",
				    "completed_at": "2026-10-22T08:06:00Z", "correct_count": 12, "total_count": 20 } ] }"""
			.formatted(UUID.randomUUID(), UUID.randomUUID())).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.accepted.attempts").value(2))
			.andExpect(jsonPath("$.data.stars_total").value(5));
	}

}
