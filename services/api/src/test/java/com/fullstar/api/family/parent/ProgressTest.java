package com.fullstar.api.family.parent;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import tools.jackson.databind.json.JsonMapper;

/** Plan 6.4: P1 This week numbers from test data (Asia/Kolkata weeks), P2 subject detail. */
class ProgressTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final int EVS = 4;

	private String bearer;

	private String grant;

	private UUID familyId;

	private UUID childId;

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
		childId = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Asha', 8, 3, 'cat') RETURNING id""", familyId);
	}

	private ResultActions parent(String path) throws Exception {
		return mvc.perform(get("/api/v1/family/parent/children/" + childId + path).header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant));
	}

	private void minute(String istTime) {
		systemQuery("""
				INSERT INTO app.usage_minutes (child_id, minute_at, family_id)
				VALUES (?, CAST(? AS timestamp) AT TIME ZONE 'Asia/Kolkata', ?) RETURNING child_id""", childId, istTime,
				familyId);
	}

	@Test
	void theWeekCountsMinutesDaysChaptersAndAreasInIndianTime() throws Exception {
		// Week of Monday 12 Oct 2026 (IST): 3 minutes on Monday, 2 on Sunday night; Saturday 11th and Monday 19th are outside
		minute("2026-10-12 00:05");
		minute("2026-10-12 00:06");
		minute("2026-10-12 18:30");
		minute("2026-10-18 23:58");
		minute("2026-10-18 23:59");
		minute("2026-10-11 23:59");
		minute("2026-10-19 00:00");
		UUID bookId = systemQuery("""
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, ?, 3, 'chapterwise') RETURNING id""", familyId, EVS);
		systemQuery("INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id) VALUES (?, ?, ?, ?) RETURNING child_id",
				childId, EVS, bookId, familyId);
		UUID water = systemQuery("""
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title, status)
				VALUES (?, ?, 1, 'Water', 'lessons_ready') RETURNING id""", bookId, familyId);
		systemQuery("""
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title, status)
				VALUES (?, ?, 2, 'Air', 'readalong_ready') RETURNING id""", bookId, familyId);
		systemQuery("""
				INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, family_chapter_id, started_at, completed_at, stars)
				VALUES (?, ?, ?, 'lesson', ?, ?, '2026-10-14T05:00:00Z', '2026-10-14T05:10:00Z', 2) RETURNING id""",
				UUID.randomUUID(), familyId, childId, EVS, water);
		UUID staff = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', 'content_admin') RETURNING id""", UUID.randomUUID().toString());
		UUID topic = systemQuery("INSERT INTO app.topics (class_level, subject_id, name) VALUES (3, ?, ?) RETURNING id", EVS,
				"Saving water " + UUID.randomUUID());
		UUID question = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang, created_by)
				VALUES ('question', 'library', 3, ?, ?, 'mcq', 'en', ?) RETURNING id""", EVS, topic, staff);
		UUID version = systemQuery("""
				INSERT INTO app.content_versions (item_id, version_no, title, body, solution, created_by)
				VALUES (?, 1, 'Q', CAST(? AS jsonb), CAST(? AS jsonb), ?) RETURNING id""", question, ContentSamples.MCQ,
				ContentSamples.MCQ_SOLUTION, staff);
		UUID attempt = UUID.randomUUID();
		systemQuery("""
				INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, topic_id, started_at)
				VALUES (?, ?, ?, 'lesson', ?, ?, '2026-10-15T05:00:00Z') RETURNING id""", attempt, familyId, childId, EVS,
				topic);
		// Two right then one wrong: the mistake stays open (two right in a row after it would resolve it)
		for (boolean correct : new boolean[] { true, true, false }) {
			systemQuery("""
					INSERT INTO app.answer_events (id, attempt_id, family_id, child_id, question_item_id, question_version_id,
					                               topic_id, is_correct, answer, answered_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', now()) RETURNING id""", UUID.randomUUID(), attempt, familyId,
					childId, question, version, topic, correct);
		}

		parent("/week?start=2026-10-15").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.start").value("2026-10-12"))
			.andExpect(jsonPath("$.data.minutes").value(5))
			.andExpect(jsonPath("$.data.active_days").value(2))
			.andExpect(jsonPath("$.data.chapters_done").value(1))
			.andExpect(jsonPath("$.data.worksheets_done").value(0))
			.andExpect(jsonPath("$.data.any_activity").value(true))
			.andExpect(jsonPath("$.data.subjects[3].code").value("evs"))
			.andExpect(jsonPath("$.data.subjects[3].chapters_done").value(1))
			.andExpect(jsonPath("$.data.subjects[3].chapters_total").value(2))
			.andExpect(jsonPath("$.data.subjects[3].lessons_done").value(1));

		// The wrong answer left an open mistake: the topic is an area to work on
		parent("/week?start=2026-10-15").andExpect(jsonPath("$.data.areas[0].topic_id").value(topic.toString()));

		parent("/subjects/" + EVS).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.chapters.length()").value(2))
			.andExpect(jsonPath("$.data.chapters[0].done").value(true))
			.andExpect(jsonPath("$.data.chapters[1].done").value(false))
			.andExpect(jsonPath("$.data.accuracy[0].correct").value(2))
			.andExpect(jsonPath("$.data.accuracy[0].answered").value(3))
			.andExpect(jsonPath("$.data.weak_spots.length()").value(0));
	}

	@Test
	void aNewChildHasNoActivityAndOtherFamiliesChildrenAreNotFound() throws Exception {
		parent("/week").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.minutes").value(0))
			.andExpect(jsonPath("$.data.any_activity").value(false))
			.andExpect(jsonPath("$.data.areas.length()").value(0));
		parent("/week?start=12-10-2026").andExpect(status().isBadRequest());
		UUID other = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Ravi', 8, 3, 'dog') RETURNING id""", newFamily());
		mvc.perform(get("/api/v1/family/parent/children/" + other + "/week").header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)).andExpect(status().isNotFound());
		parent("/subjects/9").andExpect(status().isNotFound());
	}

}
