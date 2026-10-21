package com.fullstar.api.studio.prep;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.StudioTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Plan 5.5: the S8 queue, claim, S9 pages, catalog books, linking and marking a chapter ready; a
 * second family with the same book gets its lessons at once; P19 messages and the P8a preview.
 */
class PrepFlowTest extends StudioTestSupport {

	private UUID topicId;

	@BeforeEach
	void admin() {
		asStaff("content_admin");
		topicId = newTopic("evs");
	}

	/** A family made through the API (consent, PIN), so parent calls carry a real token and grant. */
	private record Parent(UUID familyId, String bearer, String grant) {
	}

	private Parent newParent() throws Exception {
		String subject = UUID.randomUUID().toString();
		String token = TestTokens.token().subject(subject).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, token)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		String grant = data(mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, token)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andExpect(status().isCreated()).andReturn()).path("parent_grant").asString();
		UUID familyId = systemQuery("SELECT id FROM app.families WHERE keycloak_user_id = ?", subject);
		return new Parent(familyId, token, grant);
	}

	private ResultActions asParent(Parent parent, MockHttpServletRequestBuilder request, String json) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, parent.bearer())
			.header("X-Parent-Grant", parent.grant())
			.contentType(MediaType.APPLICATION_JSON)
			.content(json == null ? "" : json));
	}

	/** A Class 3 EVS chapter of the family that is ready to read along, with its open prep task. */
	private UUID[] readyChapter(UUID familyId) {
		UUID bookId = systemQuery("""
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, 4, 3, 'chapterwise') RETURNING id""", familyId);
		UUID chapterId = systemQuery("""
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title, status, page_count)
				VALUES (?, ?, 1, 'Water', 'readalong_ready', 1) RETURNING id""", bookId, familyId);
		UUID uploadId = systemQuery("""
				INSERT INTO app.uploads (family_id, family_book_id, family_chapter_id, source, status, file_count)
				VALUES (?, ?, ?, 'photos', 'processed', 1) RETURNING id""", familyId, bookId, chapterId);
		UUID fileId = systemQuery("""
				INSERT INTO app.upload_files (upload_id, family_id, object_key, content_type, byte_size, scan_status)
				VALUES (?, ?, ?, 'image/jpeg', 3, 'clean') RETURNING id""", uploadId, familyId,
				"families/" + familyId + "/uploads/" + uploadId + "/f");
		systemQuery("""
				INSERT INTO app.pages (family_chapter_id, family_id, upload_file_id, page_no, image_key, ocr_text)
				VALUES (?, ?, ?, 1, ?, 'Water is everywhere.') RETURNING id""", chapterId, familyId, fileId,
				"families/" + familyId + "/pages/p1.webp");
		UUID taskId = systemQuery("INSERT INTO app.prep_tasks (family_chapter_id) VALUES (?) RETURNING id", chapterId);
		return new UUID[] { chapterId, taskId };
	}

	/** Published content of the catalog chapter, as S5 → S11 → S6 would leave it. */
	private void published(UUID catalogChapterId, String kind, String questionType, String body, String solution) {
		UUID itemId = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang,
				                               catalog_chapter_id, created_by)
				VALUES (?, 'catalog_chapter', 3, 4, ?, ?, 'en', ?, ?) RETURNING id""", kind, topicId, questionType,
				catalogChapterId, staffId);
		UUID versionId = systemQuery("""
				INSERT INTO app.content_versions (item_id, version_no, title, body, solution, created_by)
				VALUES (?, 1, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?) RETURNING id""", itemId, kind + " " + itemId,
				body, solution, staffId);
		systemQuery("""
				INSERT INTO app.content_checks (version_id, status, model, finished_at)
				VALUES (?, 'passed', 'manual', now()) RETURNING id""", versionId);
		systemQuery("""
				UPDATE app.content_items SET current_version_id = ?, published_version_id = ?, status = 'published',
				       published_at = now() WHERE id = ? RETURNING id""", versionId, versionId, itemId);
	}

	@Test
	void anAdminPreparesAChapterAndASecondFamilyGetsItsLessonsAtOnce() throws Exception {
		Parent first = newParent();
		UUID[] a = readyChapter(first.familyId());

		// S8: the queue shows class, subject and chapter, never who the family is
		fetch("/api/v1/studio/prep-tasks").andExpect(status().isOk());
		JsonNodeAssert.task(data(fetch("/api/v1/studio/prep-tasks?status=open").andReturn()), a[1]);
		send(post("/api/v1/studio/prep-tasks/" + a[1] + "/claim"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("in_progress"))
			.andExpect(jsonPath("$.data.mine").value(true));
		String mine = bearer;
		asStaff("content_admin");
		send(post("/api/v1/studio/prep-tasks/" + a[1] + "/claim"), "").andExpect(status().isConflict());
		bearer = mine;

		// S9: pages with signed images; reading them is audited
		fetch("/api/v1/studio/family-chapters/" + a[0] + "/pages").andExpect(status().isOk())
			.andExpect(jsonPath("$.data[0].text").value("Water is everywhere."))
			.andExpect(jsonPath("$.data[0].image_url").value(org.hamcrest.Matchers.containsString("X-Amz-Signature")));
		Long viewed = systemQuery("SELECT count(*) FROM app.audit_log WHERE action = 'upload.view' AND entity_id = ?",
				a[0].toString());
		assertThat(viewed).isEqualTo(1L);

		// A prepared book and chapter, found by search, then linked
		String bookId = data(send(post("/api/v1/studio/catalog-books"), """
				{ "class_level": 3, "subject": "evs", "title": "Looking Around %s" }""".formatted(UUID.randomUUID()))
			.andExpect(status().isCreated())
			.andReturn()).path("id").asString();
		String catalogChapterId = data(send(post("/api/v1/studio/catalog-books/" + bookId + "/chapters"), """
				{ "number": 1, "title": "Water" }""").andExpect(status().isCreated()).andReturn())
			.path("chapters").path(0).path("id").asString();
		send(post("/api/v1/studio/catalog-books/" + bookId + "/chapters"), """
				{ "number": 1, "title": "Again" }""").andExpect(status().isConflict());
		fetch("/api/v1/studio/catalog-books?class=3&subject=evs&q=looking").andExpect(status().isOk())
			.andExpect(jsonPath("$.data[?(@.id == '" + bookId + "')]").exists());
		send(post("/api/v1/studio/prep-tasks/" + a[1] + "/link"), """
				{ "catalog_chapter_id": "%s" }""".formatted(catalogChapterId)).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.task.status").value("in_progress"))
			.andExpect(jsonPath("$.data.catalog.status").value("in_progress"));
		String chapterStatus = systemQuery("SELECT status FROM app.family_chapters WHERE id = ?", a[0]);
		assertThat(chapterStatus).isEqualTo("lessons_being_prepared");

		// Chapter content is created in its scope; another subject's chapter is refused
		send(post("/api/v1/studio/content-items"), """
				{ "kind": "lesson", "class_level": 3, "subject": "evs", "topic_id": "%s", "lang": "en",
				  "title": "Water lesson", "body": %s, "catalog_chapter_id": "%s" }"""
			.formatted(topicId, ContentSamples.LESSON, catalogChapterId)).andExpect(status().isCreated());
		String scope = systemQuery("SELECT scope FROM app.content_items WHERE catalog_chapter_id = ?",
				UUID.fromString(catalogChapterId));
		assertThat(scope).isEqualTo("catalog_chapter");
		UUID mathsTopic = newTopic("maths");
		send(post("/api/v1/studio/content-items"), """
				{ "kind": "lesson", "class_level": 3, "subject": "maths", "topic_id": "%s", "lang": "en",
				  "title": "Wrong book", "body": %s, "catalog_chapter_id": "%s" }"""
			.formatted(mathsTopic, ContentSamples.LESSON, catalogChapterId))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.catalog_chapter_id").value("INVALID"));

		// Not ready while the lesson is a draft and there are too few questions
		send(patch("/api/v1/studio/catalog-chapters/" + catalogChapterId), "{ \"status\": \"ready\" }")
			.andExpect(status().isConflict());
		systemQuery("DELETE FROM app.content_items WHERE catalog_chapter_id = ? RETURNING 1",
				UUID.fromString(catalogChapterId));
		UUID catalog = UUID.fromString(catalogChapterId);
		published(catalog, "lesson", null, ContentSamples.LESSON, null);
		for (int i = 0; i < CatalogService.MIN_QUESTIONS; i++) {
			published(catalog, "question", "mcq", ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION);
		}
		send(patch("/api/v1/studio/catalog-chapters/" + catalogChapterId), "{ \"status\": \"ready\" }")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("ready"))
			.andExpect(jsonPath("$.data.published_questions").value(CatalogService.MIN_QUESTIONS));
		chapterStatus = systemQuery("SELECT status FROM app.family_chapters WHERE id = ?", a[0]);
		assertThat(chapterStatus).isEqualTo("lessons_ready");
		String taskStatus = systemQuery("SELECT status FROM app.prep_tasks WHERE id = ?", a[1]);
		assertThat(taskStatus).isEqualTo("done");

		// The second family uploads the same book: linking gives it the lessons at once
		Parent second = newParent();
		UUID[] b = readyChapter(second.familyId());
		send(post("/api/v1/studio/prep-tasks/" + b[1] + "/link"), """
				{ "catalog_chapter_id": "%s" }""".formatted(catalogChapterId)).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.task.status").value("done"));
		chapterStatus = systemQuery("SELECT status FROM app.family_chapters WHERE id = ?", b[0]);
		assertThat(chapterStatus).isEqualTo("lessons_ready");
		String book = systemQuery("SELECT fb.status FROM app.family_books fb JOIN app.family_chapters fc "
				+ "ON fc.family_book_id = fb.id WHERE fc.id = ?", b[0]);
		assertThat(book).isEqualTo("lessons_ready");

		// P19: the "Lessons ready" message, read once opened
		String messageId = data(asParent(second, get("/api/v1/family/parent/messages"), null)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.unread").value(1))
			.andExpect(jsonPath("$.data.items[0].kind").value("lessons_ready"))
			.andExpect(jsonPath("$.data.items[0].body").value("Lessons for EVS Ch 1 are ready. We recommend a quick preview."))
			.andExpect(jsonPath("$.data.items[0].link.screen").value("P8a"))
			.andReturn()).path("items").path(0).path("id").asString();
		asParent(second, post("/api/v1/family/parent/messages/" + messageId + "/read"), null)
			.andExpect(status().isOk());
		asParent(second, get("/api/v1/family/parent/messages"), null).andExpect(jsonPath("$.data.unread").value(0));

		// P8a: the chapter's lesson, its question bank, Looks good / Report
		String lessonId = data(asParent(second, get("/api/v1/family/parent/chapters/" + b[0] + "/lessons"), null)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.length()").value(1))
			.andExpect(jsonPath("$.data[0].preview_result").doesNotExist())
			.andReturn()).path(0).path("content_item_id").asString();
		asParent(second, get("/api/v1/family/parent/lessons/" + lessonId + "/preview"), null)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.questions.length()").value(CatalogService.MIN_QUESTIONS));
		asParent(second, post("/api/v1/family/parent/lessons/" + lessonId + "/preview-result"),
				"{ \"result\": \"reported\" }")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.reason").value("REQUIRED"));
		asParent(second, post("/api/v1/family/parent/lessons/" + lessonId + "/preview-result"),
				"{ \"result\": \"reported\", \"reason\": \"spelling\", \"note\": \"Page 2\" }")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.preview_result").value("reported"));
		asParent(second, post("/api/v1/family/parent/lessons/" + lessonId + "/preview-result"),
				"{ \"result\": \"reported\", \"reason\": \"spelling\" }")
			.andExpect(status().isOk());
		Long reports = systemQuery("SELECT count(*) FROM app.problem_reports WHERE family_id = ?", second.familyId());
		assertThat(reports).isEqualTo(1L);
		asParent(first, post("/api/v1/family/parent/lessons/" + lessonId + "/preview-result"),
				"{ \"result\": \"looks_good\" }")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.preview_result").value("looks_good"));
	}

	@Test
	void aFamilyCannotPreviewAnotherFamilysChapterLessons() throws Exception {
		Parent owner = newParent();
		UUID[] a = readyChapter(owner.familyId());
		UUID bookId = systemQuery("""
				INSERT INTO app.catalog_books (class_level, subject_id, title) VALUES (3, 4, ?) RETURNING id""",
				"Private " + UUID.randomUUID());
		UUID catalogChapterId = systemQuery("""
				INSERT INTO app.catalog_chapters (catalog_book_id, number, title) VALUES (?, 1, 'Air') RETURNING id""",
				bookId);
		published(catalogChapterId, "lesson", null, ContentSamples.LESSON, null);
		send(post("/api/v1/studio/prep-tasks/" + a[1] + "/link"), """
				{ "catalog_chapter_id": "%s" }""".formatted(catalogChapterId)).andExpect(status().isOk());
		UUID lessonId = systemQuery("SELECT id FROM app.content_items WHERE catalog_chapter_id = ?", catalogChapterId);

		Parent other = newParent();
		asParent(other, get("/api/v1/family/parent/lessons/" + lessonId + "/preview"), null)
			.andExpect(status().isNotFound());
		asParent(other, get("/api/v1/family/parent/chapters/" + a[0] + "/lessons"), null)
			.andExpect(status().isNotFound());
		asParent(owner, get("/api/v1/family/parent/lessons/" + lessonId + "/preview"), null)
			.andExpect(status().isOk());
	}

	/** Small checks on the S8 list. */
	private static final class JsonNodeAssert {

		static void task(tools.jackson.databind.JsonNode list, UUID taskId) {
			tools.jackson.databind.JsonNode found = null;
			for (tools.jackson.databind.JsonNode task : list) {
				if (task.path("id").asString().equals(taskId.toString())) {
					found = task;
				}
			}
			assertThat(found).as("task in the queue").isNotNull();
			assertThat(found.path("class_level").asInt()).isEqualTo(3);
			assertThat(found.path("subject").asString()).isEqualTo("evs");
			assertThat(found.path("chapter_title").asString()).isEqualTo("Water");
			assertThat(found.path("family_ref").asString()).hasSize(8);
			assertThat(found.has("family_id")).isFalse();
		}

	}

}
