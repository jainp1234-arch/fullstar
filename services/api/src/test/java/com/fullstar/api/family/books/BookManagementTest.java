package com.fullstar.api.family.books;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import tools.jackson.databind.json.JsonMapper;

/** Plan 7.4: P9 Replace book removes the old chapters' progress; chapters reorder keeping their numbers. */
class BookManagementTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final int EVS = 4;

	private String bearer;

	private String grant;

	private UUID familyId;

	private UUID asha;

	private UUID ravi;

	private UUID bookId;

	private UUID water;

	private UUID air;

	private UUID food;

	private UUID staff;

	private UUID topic;

	@BeforeEach
	void family() throws Exception {
		String subject = UUID.randomUUID().toString();
		bearer = TestTokens.token().subject(subject).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		MvcResult pin = mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andExpect(status().isCreated()).andReturn();
		grant = JSON.readTree(pin.getResponse().getContentAsString()).path("data").path("parent_grant").asString();
		familyId = systemQuery("SELECT id FROM app.families WHERE keycloak_user_id = ?", subject);
		asha = child("Asha");
		ravi = child("Ravi");
		bookId = systemQuery("""
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, ?, 3, 'chapterwise') RETURNING id""", familyId, EVS);
		for (UUID child : new UUID[] { asha, ravi }) {
			systemQuery("""
					INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id)
					VALUES (?, ?, ?, ?) RETURNING child_id""", child, EVS, bookId, familyId);
		}
		water = chapter(1, "Water");
		air = chapter(2, "Air");
		food = chapter(4, "Food");
		staff = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', 'content_admin') RETURNING id""", UUID.randomUUID().toString());
		topic = systemQuery("INSERT INTO app.topics (class_level, subject_id, name) VALUES (3, ?, ?) RETURNING id", EVS,
				"Water " + UUID.randomUUID());
	}

	private UUID child(String name) {
		return systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, ?, 8, 3, 'cat') RETURNING id""", familyId, name);
	}

	private UUID chapter(int number, String title) {
		return systemQuery("""
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title, status)
				VALUES (?, ?, ?, ?, 'lessons_ready') RETURNING id""", bookId, familyId, number, title);
	}

	/** One completed attempt with stars and one wrong answer to a new question (which opens a mistake). */
	private UUID attempt(UUID child, UUID chapterId, int stars) {
		UUID question = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang, created_by)
				VALUES ('question', 'library', 3, ?, ?, 'mcq', 'en', ?) RETURNING id""", EVS, topic, staff);
		UUID version = systemQuery("""
				INSERT INTO app.content_versions (item_id, version_no, title, body, solution, created_by)
				VALUES (?, 1, 'Q', CAST(? AS jsonb), CAST(? AS jsonb), ?) RETURNING id""", question, ContentSamples.MCQ,
				ContentSamples.MCQ_SOLUTION, staff);
		UUID attempt = systemQuery("""
				INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, family_chapter_id, topic_id,
				                                   started_at, completed_at, stars)
				VALUES (?, ?, ?, ?, ?, ?, ?, now(), now(), ?) RETURNING id""", UUID.randomUUID(), familyId, child,
				chapterId == null ? "practice" : "lesson", EVS, chapterId, topic, stars);
		systemQuery("""
				INSERT INTO app.answer_events (id, attempt_id, family_id, child_id, question_item_id, question_version_id,
				                               topic_id, is_correct, answer, answered_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, false, '{}', now()) RETURNING id""", UUID.randomUUID(), attempt, familyId,
				child, question, version, topic);
		return attempt;
	}

	private ResultActions send(MockHttpServletRequestBuilder request, String json) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private static long count(String sql, Object... params) {
		Long n = systemQuery(sql, params);
		return n;
	}

	@Test
	void replacingRemovesTheOldChaptersProgressForEveryChildButKeepsStars() throws Exception {
		UUID ashaWater = attempt(asha, water, 2);
		attempt(ravi, air, 3);
		UUID ashaPractice = attempt(asha, null, 1);
		assertThat(count("SELECT count(*) FROM app.mistakes WHERE child_id = ? AND resolved_at IS NULL", asha)).isEqualTo(2);
		int ashaStars = systemQuery("SELECT stars_total FROM app.children WHERE id = ?", asha);
		assertThat(ashaStars).isEqualTo(3);

		send(post("/api/v1/family/parent/books/" + bookId + "/replace"), "{}").andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("success"))
			.andExpect(jsonPath("$.data.id").value(bookId.toString()))
			.andExpect(jsonPath("$.data.child_ids.length()").value(2))
			.andExpect(jsonPath("$.data.chapters").value(3))
			.andExpect(jsonPath("$.data.attempts").value(2));

		assertThat(count("SELECT count(*) FROM app.family_books WHERE id = ?", bookId)).isZero();
		assertThat(count("SELECT count(*) FROM app.family_chapters WHERE family_book_id = ?", bookId)).isZero();
		assertThat(count("SELECT count(*) FROM app.child_books WHERE family_book_id = ?", bookId)).isZero();
		assertThat(count("SELECT count(*) FROM app.activity_attempts WHERE id = ?", ashaWater)).isZero();
		assertThat(count("SELECT count(*) FROM app.answer_events WHERE attempt_id = ?", ashaWater)).isZero();
		assertThat(count("SELECT count(*) FROM app.activity_attempts WHERE child_id = ?", ravi)).isZero();
		assertThat(count("SELECT count(*) FROM app.mistakes WHERE child_id = ?", ravi)).isZero();
		// Progress elsewhere and stars already earned stay
		assertThat(count("SELECT count(*) FROM app.activity_attempts WHERE id = ?", ashaPractice)).isEqualTo(1);
		assertThat(count("SELECT count(*) FROM app.mistakes WHERE child_id = ? AND resolved_at IS NULL", asha)).isEqualTo(1);
		int starsAfter = systemQuery("SELECT stars_total FROM app.children WHERE id = ?", asha);
		assertThat(starsAfter).isEqualTo(3);

		// Both children are back to "No book" for EVS and can upload again
		for (UUID child : new UUID[] { asha, ravi }) {
			mvc.perform(get("/api/v1/family/parent/books").param("child_id", child.toString())
				.header(HttpHeaders.AUTHORIZATION, bearer)
				.header("X-Parent-Grant", grant))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.data[3].subject").value("evs"))
				.andExpect(jsonPath("$.data[3].book").doesNotExist());
		}
		send(post("/api/v1/family/parent/books"), """
				{ "child_id": "%s", "subject_id": %d, "upload_mode": "whole" }""".formatted(asha, EVS))
			.andExpect(status().isCreated());

		send(post("/api/v1/family/parent/books/" + bookId + "/replace"), "{}").andExpect(status().isNotFound());
	}

	@Test
	void anotherFamilysBookCannotBeReplaced() throws Exception {
		UUID other = newFamily();
		UUID otherBook = systemQuery("""
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, ?, 3, 'whole') RETURNING id""", other, EVS);
		send(post("/api/v1/family/parent/books/" + otherBook + "/replace"), "{}").andExpect(status().isNotFound())
			.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
		assertThat(count("SELECT count(*) FROM app.family_books WHERE id = ?", otherBook)).isEqualTo(1);
	}

	@Test
	void reorderingKeepsTheBooksChapterNumbers() throws Exception {
		send(put("/api/v1/family/parent/books/" + bookId + "/chapter-order"), """
				{ "chapter_ids": ["%s", "%s", "%s"] }""".formatted(food, water, air))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data[0].id").value(food.toString()))
			.andExpect(jsonPath("$.data[0].number").value(1))
			.andExpect(jsonPath("$.data[1].id").value(water.toString()))
			.andExpect(jsonPath("$.data[1].number").value(2))
			.andExpect(jsonPath("$.data[2].id").value(air.toString()))
			.andExpect(jsonPath("$.data[2].number").value(4));

		// Every chapter once, or nothing changes
		send(put("/api/v1/family/parent/books/" + bookId + "/chapter-order"), """
				{ "chapter_ids": ["%s", "%s"] }""".formatted(water, air))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.chapter_ids").value("INVALID"));
		send(put("/api/v1/family/parent/books/" + bookId + "/chapter-order"), """
				{ "chapter_ids": ["%s", "%s", "%s"] }""".formatted(water, water, air))
			.andExpect(status().isBadRequest());
		send(put("/api/v1/family/parent/books/" + bookId + "/chapter-order"), """
				{ "chapter_ids": ["not-a-uuid"] }""")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.chapter_ids").value("INVALID"));
		int foodNumber = systemQuery("SELECT number FROM app.family_chapters WHERE id = ?", food);
		assertThat(foodNumber).isEqualTo(1);

		// A whole book follows its pages; its order is set in P6
		systemQuery("UPDATE app.family_books SET upload_mode = 'whole' WHERE id = ? RETURNING id", bookId);
		send(put("/api/v1/family/parent/books/" + bookId + "/chapter-order"), """
				{ "chapter_ids": ["%s", "%s", "%s"] }""".formatted(water, air, food))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("CONFLICT"));
	}

}
