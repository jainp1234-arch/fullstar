package com.fullstar.api.family.books;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.common.jobs.JobEnvelope;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.QueueUrls;
import com.fullstar.api.common.storage.StorageKeys;
import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestAws;
import com.fullstar.api.testsupport.TestTokens;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sqs.SqsClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Plan 5.3: the API applies book-process results, the parent confirms a split (P6) and retakes a page (P8). */
class BookProcessResultTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	@Autowired
	private SqsClient sqs;

	@Autowired
	private QueueUrls queueUrls;

	@Autowired
	private S3Client s3;

	private String bearer;

	private String grant;

	private UUID childId;

	private UUID familyId;

	@BeforeEach
	void family() throws Exception {
		bearer = TestTokens.token().subject(UUID.randomUUID().toString()).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		grant = data(mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andExpect(status().isCreated()).andReturn()).path("parent_grant").asString();
		childId = UUID.fromString(data(send(post("/api/v1/family/parent/children"), """
				{ "first_name": "Mia", "age": 8, "class_level": 3, "avatar_key": "cat" }""").andExpect(status().isCreated())
			.andReturn()).path("id").asString());
	}

	private ResultActions send(MockHttpServletRequestBuilder request, String json) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private ResultActions read(MockHttpServletRequestBuilder request) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer).header("X-Parent-Grant", grant));
	}

	private static JsonNode data(MvcResult result) throws Exception {
		return JSON.readTree(result.getResponse().getContentAsString()).path("data");
	}

	private UUID newBook(String mode) throws Exception {
		UUID bookId = UUID.fromString(data(send(post("/api/v1/family/parent/books"), """
				{ "child_id": "%s", "subject_id": 4, "upload_mode": "%s" }""".formatted(childId, mode))
			.andExpect(status().isCreated())
			.andReturn()).path("id").asString());
		familyId = systemQuery("SELECT family_id FROM app.family_books WHERE id = ?", bookId);
		return bookId;
	}

	/** An upload that book-reader is processing, with one photo file. */
	private UUID processingUpload(UUID bookId, UUID chapterId, UUID retakePageId) {
		UUID uploadId = systemQuery("""
				INSERT INTO app.uploads (family_id, family_book_id, family_chapter_id, source, status, file_count,
				                         retake_page_id)
				VALUES (?, ?, ?, 'photos', 'processing', 1, ?) RETURNING id""", familyId, bookId, chapterId, retakePageId);
		systemQuery("""
				INSERT INTO app.upload_files (upload_id, family_id, object_key, content_type, byte_size, scan_status)
				VALUES (?, ?, ?, 'image/jpeg', 3, 'clean') RETURNING id""", uploadId, familyId,
				StorageKeys.upload(familyId, uploadId, UUID.randomUUID()));
		return uploadId;
	}

	private UUID fileOf(UUID uploadId) {
		return systemQuery("SELECT id FROM app.upload_files WHERE upload_id = ?", uploadId);
	}

	/** pages.json as book-reader writes it, with the given page qualities. */
	private String pagesJson(UUID uploadId, List<String> qualities, List<Map<String, Object>> suggested) {
		List<Map<String, Object>> pages = new ArrayList<>();
		for (int i = 0; i < qualities.size(); i++) {
			UUID pageId = UUID.randomUUID();
			String imageKey = "families/" + familyId + "/pages/" + pageId + ".webp";
			s3.putObject(r -> r.bucket(TestAws.BUCKET).key(imageKey), RequestBody.fromBytes(new byte[] { 'R', 'I', 'F', 'F' }));
			pages.add(Map.of("page_id", pageId.toString(), "page_no", i + 1, "file_id", fileOf(uploadId).toString(),
					"image_key", imageKey, "text", "Page " + (i + 1) + " text", "confidence",
					"unclear".equals(qualities.get(i)) ? 31.5 : 91.25, "quality", qualities.get(i)));
		}
		String key = "families/" + familyId + "/uploads/" + uploadId + "/pages.json";
		s3.putObject(r -> r.bucket(TestAws.BUCKET).key(key),
				RequestBody.fromBytes(JSON.writeValueAsBytes(Map.of("pages", pages, "suggested_chapters", suggested))));
		return key;
	}

	private void report(UUID uploadId, String outcome, Object result) {
		String idempotencyKey = "book.process:" + uploadId;
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("job_id", UUID.randomUUID().toString());
		payload.put("idempotency_key", idempotencyKey);
		payload.put("type", "book.process");
		payload.put("outcome", outcome);
		payload.put("result", result);
		payload.put("error", "failure".equals(outcome) ? Map.of("code", "WORKER_FAILED") : null);
		String body = JSON.writeValueAsString(new JobEnvelope(UUID.randomUUID(), idempotencyKey, "job.result", 1,
				Instant.now(), JSON.valueToTree(payload)));
		String url = queueUrls.of(JobQueue.JOB_RESULTS);
		sqs.sendMessage(r -> r.queueUrl(url).messageBody(body));
	}

	private String uploadStatus(UUID uploadId) {
		return systemQuery("SELECT status FROM app.uploads WHERE id = ?", uploadId);
	}

	private static void await(BooleanSupplier condition, String what) throws InterruptedException {
		Instant until = Instant.now().plus(Duration.ofSeconds(20));
		while (!condition.getAsBoolean()) {
			if (Instant.now().isAfter(until)) {
				throw new AssertionError("timed out: " + what);
			}
			Thread.sleep(200);
		}
	}

	@Test
	void aWholeBookGetsSuggestedChaptersAndTheParentConfirmsTheSplit() throws Exception {
		UUID bookId = newBook("whole");
		UUID uploadId = processingUpload(bookId, null, null);
		String key = pagesJson(uploadId, List.of("ok", "ok", "ok", "ok", "ok"),
				List.of(Map.of("number", 1, "title", "Plants", "start_page", 1),
						Map.of("number", 2, "title", "Animals", "start_page", 3),
						Map.of("number", 3, "title", "Water", "start_page", 5)));
		report(uploadId, "success", Map.of("result_key", key, "page_count", 5, "unclear_pages", 0));
		await(() -> "processed".equals(uploadStatus(uploadId)), "upload processed");

		read(get("/api/v1/family/parent/books/" + bookId + "/chapters")).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.length()").value(3))
			.andExpect(jsonPath("$.data[1].title").value("Animals"))
			.andExpect(jsonPath("$.data[1].status").value("suggested"))
			.andExpect(jsonPath("$.data[1].page_count").value(2));
		String link = systemQuery("SELECT link->>'screen' FROM app.messages WHERE family_id = ? AND title = 'Check the chapters'",
				familyId);
		assertThat(link).isEqualTo("P6");

		// Start pages must begin at 1 and go up
		send(put("/api/v1/family/parent/books/" + bookId + "/chapters"), """
				{ "chapters": [ { "number": 1, "title": "Plants", "start_page": 2 } ] }""")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields['chapters[0].start_page']").value("INVALID"));

		// Merge Animals into Plants, split Water at page 4, swap the numbers round
		send(put("/api/v1/family/parent/books/" + bookId + "/chapters"), """
				{ "chapters": [ { "number": 2, "title": "Plants and animals", "start_page": 1 },
				                { "number": 1, "title": "Water", "start_page": 4 } ] }""")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.length()").value(2))
			.andExpect(jsonPath("$.data[0].title").value("Water"))
			.andExpect(jsonPath("$.data[0].page_count").value(2))
			.andExpect(jsonPath("$.data[0].status").value("processing"))
			.andExpect(jsonPath("$.data[1].title").value("Plants and animals"))
			.andExpect(jsonPath("$.data[1].page_count").value(3));
		Long pages = systemQuery("SELECT count(*) FROM app.pages WHERE family_id = ?", familyId);
		assertThat(pages).isEqualTo(5L);
		String waterFirst = systemQuery("""
				SELECT p.ocr_text FROM app.pages p JOIN app.family_chapters c ON c.id = p.family_chapter_id
				 WHERE c.family_book_id = ? AND c.title = 'Water' AND p.page_no = 1""", bookId);
		assertThat(waterFirst).isEqualTo("Page 4 text");

		// Once read-along is being prepared the split is fixed
		systemQuery("UPDATE app.family_chapters SET status = 'readalong_ready' WHERE family_book_id = ? RETURNING 1",
				bookId);
		send(put("/api/v1/family/parent/books/" + bookId + "/chapters"), """
				{ "chapters": [ { "number": 1, "title": "All", "start_page": 1 } ] }""")
			.andExpect(status().isConflict());
	}

	@Test
	void unclearPagesNeedAttentionAndARetakeReplacesThePage() throws Exception {
		UUID bookId = newBook("chapterwise");
		UUID chapterId = systemQuery("""
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title)
				VALUES (?, ?, 1, 'Water') RETURNING id""", bookId, familyId);
		UUID uploadId = processingUpload(bookId, chapterId, null);
		String key = pagesJson(uploadId, List.of("ok", "unclear"), List.of());
		report(uploadId, "success", Map.of("result_key", key, "page_count", 2, "unclear_pages", 1));
		await(() -> "processed".equals(uploadStatus(uploadId)), "upload processed");
		String chapterStatus = systemQuery("SELECT status FROM app.family_chapters WHERE id = ?", chapterId);
		assertThat(chapterStatus).isEqualTo("needs_attention");
		String screen = systemQuery("SELECT link->>'screen' FROM app.messages WHERE family_id = ? AND kind = 'pages_unclear'",
				familyId);
		assertThat(screen).isEqualTo("P8");

		JsonNode unclear = data(read(get("/api/v1/family/parent/chapters/" + chapterId + "/pages?quality=unclear"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.length()").value(1))
			.andExpect(jsonPath("$.data[0].page_no").value(2))
			.andReturn());
		assertThat(unclear.path(0).path("image_url").asString()).contains("X-Amz-Signature");
		read(get("/api/v1/family/parent/chapters/" + chapterId + "/pages?quality=blurry"))
			.andExpect(status().isBadRequest());

		UUID pageId = UUID.fromString(unclear.path(0).path("id").asString());
		JsonNode retake = data(send(post("/api/v1/family/parent/pages/" + pageId + "/retake"), """
				{ "name": "page-2.jpg", "type": "image/jpeg", "size": 3 }""").andExpect(status().isCreated())
			.andExpect(jsonPath("$.data.status").value("awaiting_files"))
			.andExpect(jsonPath("$.data.files.length()").value(1))
			.andReturn());
		UUID retakeId = UUID.fromString(retake.path("id").asString());
		UUID stored = systemQuery("SELECT retake_page_id FROM app.uploads WHERE id = ?", retakeId);
		assertThat(stored).isEqualTo(pageId);

		// book-reader has read the new photo
		systemQuery("UPDATE app.uploads SET status = 'processing' WHERE id = ? RETURNING 1", retakeId);
		String retakeKey = pagesJson(retakeId, List.of("ok"), List.of());
		report(retakeId, "success", Map.of("result_key", retakeKey, "page_count", 1, "unclear_pages", 0));
		await(() -> "processed".equals(uploadStatus(retakeId)), "retake processed");
		String quality = systemQuery("SELECT quality FROM app.pages WHERE id = ?", pageId);
		assertThat(quality).isEqualTo("retaken");
		chapterStatus = systemQuery("SELECT status FROM app.family_chapters WHERE id = ?", chapterId);
		assertThat(chapterStatus).isEqualTo("processing");
	}

	@Test
	void aTooLongPdfIsRejectedWithAMessage() throws Exception {
		UUID bookId = newBook("whole");
		UUID uploadId = processingUpload(bookId, null, null);
		report(uploadId, "success", Map.of("rejected", "too_many_pages"));
		await(() -> "rejected".equals(uploadStatus(uploadId)), "upload rejected");
		String reason = systemQuery("SELECT reject_reason FROM app.uploads WHERE id = ?", uploadId);
		assertThat(reason).isEqualTo("too_many_pages");
		String body = systemQuery("SELECT body FROM app.messages WHERE family_id = ? AND kind = 'upload_problem'",
				familyId);
		assertThat(body).contains("more than 300 pages");
	}

	/** The readalong-narrate job queued for this chapter (Plan 5.4). */
	private JsonNode narrateJob(UUID chapterId) throws InterruptedException {
		String url = queueUrls.of(JobQueue.READALONG_NARRATE);
		Instant until = Instant.now().plus(Duration.ofSeconds(20));
		while (Instant.now().isBefore(until)) {
			JsonNode found = null;
			for (var message : sqs.receiveMessage(r -> r.queueUrl(url).maxNumberOfMessages(10).waitTimeSeconds(1))
				.messages()) {
				JsonNode envelope = JSON.readTree(message.body());
				if (found == null
						&& envelope.path("payload").path("family_chapter_id").asString().equals(chapterId.toString())) {
					sqs.deleteMessage(r -> r.queueUrl(url).receiptHandle(message.receiptHandle()));
					found = envelope;
				}
				else {
					// Another chapter's job: visible again at once (the queue's timeout is 30 minutes)
					sqs.changeMessageVisibility(
							r -> r.queueUrl(url).receiptHandle(message.receiptHandle()).visibilityTimeout(0));
				}
			}
			if (found != null) {
				return found;
			}
		}
		throw new AssertionError("no readalong-narrate job for " + chapterId);
	}

	/** What voice-maker writes and reports for a narrate job (Plan 8.2): audio and timings per page. */
	private String narrate(JsonNode job, String outcome) {
		JsonNode payload = job.path("payload");
		String familyKey = "families/" + payload.path("family_id").asString();
		String resultKey = payload.path("pages_key").asString().replace("-input.json", "-result.json");
		List<Map<String, Object>> pages = new ArrayList<>();
		JsonNode input = JSON.readTree(s3.getObjectAsBytes(r -> r.bucket(TestAws.BUCKET)
			.key(payload.path("pages_key").asString())).asByteArray());
		for (JsonNode page : input.path("pages")) {
			pages.add(Map.of("page_id", page.path("page_id").asString(), "audio_key",
					familyKey + "/audio/" + page.path("page_id").asString() + ".mp3", "word_timings",
					List.of(Map.of("w", "Page", "start_ms", 300, "end_ms", 620))));
		}
		s3.putObject(r -> r.bucket(TestAws.BUCKET).key(resultKey),
				RequestBody.fromBytes(JSON.writeValueAsBytes(Map.of("pages", pages))));
		String key = job.path("idempotency_key").asString();
		Map<String, Object> result = new LinkedHashMap<>();
		result.put("job_id", job.path("job_id").asString());
		result.put("idempotency_key", key);
		result.put("type", "readalong.narrate");
		result.put("outcome", outcome);
		result.put("result", "success".equals(outcome) ? Map.of("result_key", resultKey, "page_count", pages.size()) : null);
		result.put("error", "failure".equals(outcome) ? Map.of("code", "WORKER_FAILED") : null);
		String body = JSON.writeValueAsString(new JobEnvelope(UUID.randomUUID(), key, "job.result", 1, Instant.now(),
				JSON.valueToTree(result)));
		resend(body);
		return body;
	}

	private void resend(String body) {
		String url = queueUrls.of(JobQueue.JOB_RESULTS);
		sqs.sendMessage(r -> r.queueUrl(url).messageBody(body));
	}

	private String chapterStatus(UUID chapterId) {
		return systemQuery("SELECT status FROM app.family_chapters WHERE id = ?", chapterId);
	}

	@Test
	void aClearChapterIsReadAloudThenReadyWithAMessageAndAPrepTask() throws Exception {
		UUID bookId = newBook("chapterwise");
		UUID chapterId = systemQuery("""
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title)
				VALUES (?, ?, 2, 'Water') RETURNING id""", bookId, familyId);
		UUID uploadId = processingUpload(bookId, chapterId, null);
		String key = pagesJson(uploadId, List.of("ok", "ok"), List.of());
		report(uploadId, "success", Map.of("result_key", key, "page_count", 2, "unclear_pages", 0));

		JsonNode job = narrateJob(chapterId);
		assertThat(job.path("type").asString()).isEqualTo("readalong.narrate");
		assertThat(job.path("payload").path("lang").asString()).isEqualTo("en");
		assertThat(job.path("payload").path("page_count").asInt()).isEqualTo(2);
		assertThat(chapterStatus(chapterId)).isEqualTo("processing");

		String result = narrate(job, "success");
		await(() -> "readalong_ready".equals(chapterStatus(chapterId)), "chapter readalong_ready");
		Long narrated = systemQuery("""
				SELECT count(*) FROM app.pages WHERE family_chapter_id = ? AND narration_audio_key LIKE 'families/%/audio/%.mp3'
				   AND jsonb_array_length(word_timings) = 1""", chapterId);
		assertThat(narrated).isEqualTo(2L);
		String book = systemQuery("SELECT status FROM app.family_books WHERE id = ?", bookId);
		assertThat(book).isEqualTo("readalong_ready");
		String message = systemQuery("SELECT title || ' | ' || body FROM app.messages WHERE family_id = ? AND kind = 'readalong_ready'",
				familyId);
		assertThat(message).isEqualTo("Ready to read along | EVS Ch 2 is ready to read along.");
		Long open = systemQuery("SELECT count(*) FROM app.prep_tasks WHERE family_chapter_id = ? AND status = 'open'",
				chapterId);
		assertThat(open).isEqualTo(1L);
		// The narration files are cleaned up once applied
		await(() -> s3.listObjectsV2(r -> r.bucket(TestAws.BUCKET)
			.prefix("families/" + familyId + "/chapters/")).keyCount() == 0, "narration files deleted");

		// A repeated result changes nothing
		resend(result);
		Thread.sleep(2_000);
		Long messages = systemQuery("SELECT count(*) FROM app.messages WHERE family_id = ? AND kind = 'readalong_ready'",
				familyId);
		assertThat(messages).isEqualTo(1L);
	}

	@Test
	void unclearPagesWaitForTheRetakeAndAFailedNarrationKeepsTheChapterGettingReady() throws Exception {
		UUID bookId = newBook("chapterwise");
		UUID chapterId = systemQuery("""
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title)
				VALUES (?, ?, 1, 'Plants') RETURNING id""", bookId, familyId);
		UUID uploadId = processingUpload(bookId, chapterId, null);
		String key = pagesJson(uploadId, List.of("ok", "unclear"), List.of());
		report(uploadId, "success", Map.of("result_key", key, "page_count", 2, "unclear_pages", 1));
		await(() -> "processed".equals(uploadStatus(uploadId)), "upload processed");
		assertThat(chapterStatus(chapterId)).isEqualTo("needs_attention");

		UUID pageId = systemQuery("SELECT id FROM app.pages WHERE family_chapter_id = ? AND quality = 'unclear'",
				chapterId);
		UUID retakeId = processingUpload(bookId, chapterId, pageId);
		String retakeKey = pagesJson(retakeId, List.of("ok"), List.of());
		report(retakeId, "success", Map.of("result_key", retakeKey, "page_count", 1, "unclear_pages", 0));
		JsonNode job = narrateJob(chapterId);
		assertThat(job.path("payload").path("page_count").asInt()).isEqualTo(2);

		narrate(job, "failure");
		Thread.sleep(2_000);
		assertThat(chapterStatus(chapterId)).isEqualTo("processing");
		Long tasks = systemQuery("SELECT count(*) FROM app.prep_tasks WHERE family_chapter_id = ?", chapterId);
		assertThat(tasks).isZero();
	}

	@Test
	void confirmingASplitReadsEachChapterAloud() throws Exception {
		UUID bookId = newBook("whole");
		UUID uploadId = processingUpload(bookId, null, null);
		String key = pagesJson(uploadId, List.of("ok", "ok", "ok"),
				List.of(Map.of("number", 1, "title", "Plants", "start_page", 1),
						Map.of("number", 2, "title", "Water", "start_page", 3)));
		report(uploadId, "success", Map.of("result_key", key, "page_count", 3, "unclear_pages", 0));
		await(() -> "processed".equals(uploadStatus(uploadId)), "upload processed");

		JsonNode chapters = data(send(put("/api/v1/family/parent/books/" + bookId + "/chapters"), """
				{ "chapters": [ { "number": 1, "title": "Plants", "start_page": 1 },
				                { "number": 2, "title": "Water", "start_page": 2 } ] }""")
			.andExpect(status().isOk())
			.andReturn());
		JsonNode first = narrateJob(UUID.fromString(chapters.path(0).path("id").asString()));
		JsonNode second = narrateJob(UUID.fromString(chapters.path(1).path("id").asString()));
		assertThat(first.path("payload").path("page_count").asInt()).isEqualTo(1);
		assertThat(second.path("payload").path("page_count").asInt()).isEqualTo(2);
	}

}
