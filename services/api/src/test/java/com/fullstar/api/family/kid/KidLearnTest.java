package com.fullstar.api.family.kid;

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
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.json.JsonMapper;

/** Plan 6.1: K1 home, K2 subject (book or practice), K3 chapter and topic cards. */
class KidLearnTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final int EVS = 4;

	private String bearer;

	private UUID familyId;

	private UUID childId;

	private UUID staffId;

	@BeforeEach
	void family() throws Exception {
		String subject = UUID.randomUUID().toString();
		bearer = TestTokens.token().subject(subject).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		familyId = systemQuery("SELECT id FROM app.families WHERE keycloak_user_id = ?", subject);
		childId = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key, stars_total)
				VALUES (?, 'Asha', 8, 3, 'cat', 12) RETURNING id""", familyId);
		staffId = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', 'content_admin') RETURNING id""", UUID.randomUUID().toString());
	}

	private ResultActions kid(String path) throws Exception {
		return kid(path, childId);
	}

	private ResultActions kid(String path, UUID child) throws Exception {
		return mvc.perform(get("/api/v1/family/kid" + path).header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Child-Id", child.toString()));
	}

	private UUID topic(String name, UUID parent) {
		return systemQuery("""
				INSERT INTO app.topics (class_level, subject_id, parent_id, name) VALUES (3, ?, ?, ?) RETURNING id""",
				EVS, parent, name + " " + UUID.randomUUID());
	}

	/** A published item (lesson or question), as S5 → S11 → S6 leave it. */
	private UUID published(String kind, UUID topicId, UUID catalogChapterId, String title) {
		UUID itemId = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang,
				                               catalog_chapter_id, created_by)
				VALUES (?, ?, 3, ?, ?, ?, 'en', ?, ?) RETURNING id""", kind,
				catalogChapterId == null ? "library" : "catalog_chapter", EVS, topicId,
				"question".equals(kind) ? "mcq" : null, catalogChapterId, staffId);
		UUID versionId = systemQuery("""
				INSERT INTO app.content_versions (item_id, version_no, title, body, solution, duration_seconds, created_by)
				VALUES (?, 1, ?, CAST(? AS jsonb), CAST(? AS jsonb), 40, ?) RETURNING id""", itemId, title,
				"lesson".equals(kind) ? ContentSamples.LESSON : ContentSamples.MCQ,
				"lesson".equals(kind) ? null : ContentSamples.MCQ_SOLUTION, staffId);
		systemQuery("INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual') RETURNING id",
				versionId);
		systemQuery("""
				UPDATE app.content_items SET current_version_id = ?, published_version_id = ?, status = 'published',
				       published_at = now() WHERE id = ? RETURNING id""", versionId, versionId, itemId);
		return itemId;
	}

	/** The child's EVS book with one chapter in each status given. */
	private UUID[] book(String... statuses) {
		UUID bookId = systemQuery("""
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, ?, 3, 'chapterwise') RETURNING id""", familyId, EVS);
		systemQuery("""
				INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id)
				VALUES (?, ?, ?, ?) RETURNING child_id""", childId, EVS, bookId, familyId);
		UUID[] chapters = new UUID[statuses.length];
		for (int i = 0; i < statuses.length; i++) {
			chapters[i] = systemQuery("""
					INSERT INTO app.family_chapters (family_book_id, family_id, number, title, status)
					VALUES (?, ?, ?, ?, ?) RETURNING id""", bookId, familyId, i + 1, "Chapter " + (i + 1), statuses[i]);
		}
		return chapters;
	}

	@Test
	void withoutABookASubjectShowsTheClassTopicsAndTheirLessons() throws Exception {
		UUID water = topic("Water", null);
		UUID rain = topic("Rain", water);
		UUID lesson = published("lesson", rain, null, "Where rain comes from");
		published("question", water, null, "Rain question");
		systemQuery("INSERT INTO app.usage_minutes (child_id, minute_at, family_id) VALUES (?, date_trunc('minute', now()), ?) RETURNING child_id",
				childId, familyId);

		kid("/home").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.child.first_name").value("Asha"))
			.andExpect(jsonPath("$.data.stars").value(12))
			.andExpect(jsonPath("$.data.minutes_today").value(1))
			.andExpect(jsonPath("$.data.daily_limit_minutes").value(30))
			.andExpect(jsonPath("$.data.subjects.length()").value(4))
			.andExpect(jsonPath("$.data.subjects[3].code").value("evs"))
			.andExpect(jsonPath("$.data.subjects[3].mode").value("practice"))
			.andExpect(jsonPath("$.data.continue_card").doesNotExist());

		kid("/subjects/" + EVS).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.mode").value("practice"))
			.andExpect(jsonPath("$.data.entries[?(@.id == '" + water + "')].done").value(false))
			.andExpect(jsonPath("$.data.entries[?(@.id == '" + rain + "')]").isEmpty());
		kid("/topics/" + water).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.kind").value("topic"))
			.andExpect(jsonPath("$.data.lessons[0].content_item_id").value(lesson.toString()))
			.andExpect(jsonPath("$.data.read_along").value(false))
			.andExpect(jsonPath("$.data.worksheet").value(true));

		// A lesson left halfway is the Continue card; finished, it is ticked
		UUID attempt = UUID.randomUUID();
		systemQuery("""
				INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, content_item_id, topic_id,
				                                   started_at, resume_state)
				VALUES (?, ?, ?, 'lesson', ?, ?, ?, now(), '{"position_s": 12}') RETURNING id""", attempt, familyId,
				childId, EVS, lesson, water);
		kid("/home").andExpect(jsonPath("$.data.continue_card.content_item_id").value(lesson.toString()))
			.andExpect(jsonPath("$.data.continue_card.title").value("Where rain comes from"))
			.andExpect(jsonPath("$.data.continue_card.resume_state.position_s").value(12));
		systemQuery("UPDATE app.activity_attempts SET completed_at = now() WHERE id = ? RETURNING id", attempt);
		kid("/home").andExpect(jsonPath("$.data.continue_card").doesNotExist());
		kid("/subjects/" + EVS).andExpect(jsonPath("$.data.entries[?(@.id == '" + water + "')].done").value(true));
	}

	@Test
	void aBookShowsOnlyReadyChaptersAndLessonsAreComingSoonUntilPublished() throws Exception {
		UUID[] chapters = book("processing", "readalong_ready", "lessons_ready");
		kid("/home").andExpect(jsonPath("$.data.subjects[3].mode").value("book"));
		kid("/subjects/" + EVS).andExpect(jsonPath("$.data.mode").value("book"))
			.andExpect(jsonPath("$.data.entries.length()").value(2))
			.andExpect(jsonPath("$.data.entries[0].number").value(2));
		kid("/chapters/" + chapters[0]).andExpect(status().isNotFound());

		// Read-along now, the lesson "Coming soon"
		kid("/chapters/" + chapters[1]).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.lessons.length()").value(0))
			.andExpect(jsonPath("$.data.read_along").value(true))
			.andExpect(jsonPath("$.data.worksheet").value(false));

		UUID catalogBook = systemQuery("INSERT INTO app.catalog_books (class_level, subject_id, title) VALUES (3, ?, ?) RETURNING id",
				EVS, "Looking Around " + UUID.randomUUID());
		UUID catalogChapter = systemQuery("""
				INSERT INTO app.catalog_chapters (catalog_book_id, number, title, status) VALUES (?, 3, 'Water', 'ready')
				RETURNING id""", catalogBook);
		systemQuery("UPDATE app.family_chapters SET catalog_chapter_id = ? WHERE id = ? RETURNING id", catalogChapter,
				chapters[2]);
		UUID topicId = topic("Water", null);
		published("lesson", topicId, catalogChapter, "Water around us");
		published("question", topicId, catalogChapter, "Water question");
		kid("/chapters/" + chapters[2]).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.lessons[0].title").value("Water around us"))
			.andExpect(jsonPath("$.data.worksheet").value(true));
	}

	@Test
	void anotherFamilysChildOrAnUnknownSubjectIsRefused() throws Exception {
		UUID otherFamily = newFamily();
		UUID otherChild = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Ravi', 8, 3, 'dog') RETURNING id""", otherFamily);
		kid("/home", otherChild).andExpect(status().isForbidden())
			.andExpect(jsonPath("$.error.code").value("CHILD_NOT_IN_FAMILY"));
		kid("/subjects/5").andExpect(status().isNotFound());
		kid("/topics/" + UUID.randomUUID()).andExpect(status().isNotFound());
	}

}
