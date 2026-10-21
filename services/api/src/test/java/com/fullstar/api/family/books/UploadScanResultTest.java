package com.fullstar.api.family.books;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.api.common.jobs.JobEnvelope;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.QueueUrls;
import com.fullstar.api.common.storage.FileStorage;
import com.fullstar.api.common.storage.StorageKeys;
import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestAws;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Plan 5.2: the API applies book-reader's upload-scan result (clean, infected, failed) once. */
class UploadScanResultTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	@Autowired
	private SqsClient sqs;

	@Autowired
	private QueueUrls queueUrls;

	@Autowired
	private S3Client s3;

	@Autowired
	private FileStorage storage;

	private UUID familyId;

	private UUID chapterId;

	private UUID uploadId;

	private List<String> keys;

	@BeforeEach
	void aScanningUpload() {
		familyId = newFamily();
		UUID bookId = systemQuery("""
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, 4, 3, 'chapterwise') RETURNING id""", familyId);
		chapterId = systemQuery("""
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title)
				VALUES (?, ?, 1, 'Water') RETURNING id""", bookId, familyId);
		uploadId = systemQuery("""
				INSERT INTO app.uploads (family_id, family_book_id, family_chapter_id, source, status, file_count)
				VALUES (?, ?, ?, 'photos', 'scanning', 2) RETURNING id""", familyId, bookId, chapterId);
		keys = List.of(file(), file());
	}

	private String file() {
		UUID fileId = UUID.randomUUID();
		String key = StorageKeys.upload(familyId, uploadId, fileId);
		systemQuery("""
				INSERT INTO app.upload_files (id, upload_id, family_id, object_key, content_type, byte_size)
				VALUES (?, ?, ?, ?, 'image/jpeg', 3) RETURNING id""", fileId, uploadId, familyId, key);
		s3.putObject(r -> r.bucket(TestAws.BUCKET).key(key), RequestBody.fromBytes(new byte[] { (byte) 0xFF, (byte) 0xD8, (byte) 0xFF }));
		return key;
	}

	/** What book-reader sends to job-results (Schema §12). */
	private void report(String outcome, JsonNode result) {
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("job_id", UUID.randomUUID().toString());
		payload.put("idempotency_key", "upload.scan:" + uploadId);
		payload.put("type", "upload.scan");
		payload.put("outcome", outcome);
		payload.put("result", result);
		payload.put("error", "failure".equals(outcome) ? Map.of("code", "WORKER_FAILED") : null);
		String body = JSON.writeValueAsString(new JobEnvelope(UUID.randomUUID(), "upload.scan:" + uploadId,
				"job.result", 1, Instant.now(), JSON.valueToTree(payload)));
		String url = queueUrls.of(JobQueue.JOB_RESULTS);
		sqs.sendMessage(r -> r.queueUrl(url).messageBody(body));
	}

	private JsonNode scanResult(boolean secondInfected) {
		return JSON.valueToTree(Map.of("infected", secondInfected, "files", List.of(
				Map.of("object_key", keys.get(0), "result", "clean"),
				Map.of("object_key", keys.get(1), "result", secondInfected ? "infected" : "clean", "signature",
						secondInfected ? "Eicar-Test-Signature" : ""))));
	}

	private String uploadStatus() {
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
	void aCleanUploadGoesOnToBookProcess() throws Exception {
		String processUrl = queueUrls.of(JobQueue.BOOK_PROCESS);
		report("success", scanResult(false));
		await(() -> "processing".equals(uploadStatus()), "upload processing");
		Long clean = systemQuery("SELECT count(*) FROM app.upload_files WHERE upload_id = ? AND scan_status = 'clean'",
				uploadId);
		assertThat(clean).isEqualTo(2L);

		List<Message> jobs = sqs.receiveMessage(r -> r.queueUrl(processUrl).maxNumberOfMessages(10).waitTimeSeconds(5))
			.messages();
		assertThat(jobs).anySatisfy(message -> {
			JsonNode envelope = JSON.readTree(message.body());
			assertThat(envelope.path("type").asString()).isEqualTo("book.process");
			assertThat(envelope.path("idempotency_key").asString()).isEqualTo("book.process:" + uploadId);
			assertThat(envelope.path("payload").path("family_chapter_id").asString()).isEqualTo(chapterId.toString());
			assertThat(envelope.path("payload").path("mode").asString()).isEqualTo("chapterwise");
		});
	}

	@Test
	void anInfectedFileRejectsTheUploadTellsTheParentAndDeletesTheFiles() throws Exception {
		report("success", scanResult(true));
		await(() -> "rejected".equals(uploadStatus()), "upload rejected");
		String reason = systemQuery("SELECT reject_reason FROM app.uploads WHERE id = ?", uploadId);
		assertThat(reason).isEqualTo("infected");
		String chapter = systemQuery("SELECT status FROM app.family_chapters WHERE id = ?", chapterId);
		assertThat(chapter).isEqualTo("needs_attention");
		String message = systemQuery("SELECT title || ' | ' || body FROM app.messages WHERE family_id = ? AND kind = 'upload_problem'",
				familyId);
		assertThat(message).startsWith("Upload not used | A file you uploaded for EVS looked unsafe");
		String link = systemQuery("SELECT link->>'screen' FROM app.messages WHERE family_id = ?", familyId);
		assertThat(link).isEqualTo("P4");
		await(() -> storage.size(keys.get(0)) < 0 && storage.size(keys.get(1)) < 0, "files deleted");
	}

	@Test
	void aFailedScanFailsTheUploadAndADuplicateResultChangesNothing() throws Exception {
		report("failure", null);
		await(() -> "failed".equals(uploadStatus()), "upload failed");
		report("success", scanResult(false));
		Thread.sleep(2_000);
		assertThat(uploadStatus()).isEqualTo("failed");
		Long messages = systemQuery("SELECT count(*) FROM app.messages WHERE family_id = ?", familyId);
		assertThat(messages).isEqualTo(1L);
	}

}
