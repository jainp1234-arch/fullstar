package com.fullstar.api.family.books;

import com.fullstar.api.common.jobs.JobPublisher;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.JobResult;
import com.fullstar.api.common.jobs.JobResultHandler;
import com.fullstar.api.common.storage.FileStorage;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Applies the upload-scan result of book-reader (Schema §8.4, §12; Plan 5.2), once per job, as
 * app_system. All files clean → the upload is processing and book-process is queued. Any file
 * infected → the upload is rejected (infected), its files are deleted and the parent gets an
 * upload_problem message. A failed scan → the upload failed, with a message to try again.
 */
@Component
public class UploadScanResultHandler implements JobResultHandler {

	private static final Logger log = LoggerFactory.getLogger(UploadScanResultHandler.class);

	public static final String PROCESS_JOB = "book.process";

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JobPublisher jobs;

	private final FileStorage storage;

	public UploadScanResultHandler(JobPublisher jobs, FileStorage storage) {
		this.jobs = jobs;
		this.storage = storage;
	}

	@Override
	public String type() {
		return UploadService.SCAN_JOB;
	}

	@Override
	public void apply(JobResult result, JdbcTemplate system) {
		// Keys are "<job type>:<upload id>", so every job of one upload has its own key
		UUID uploadId = UUID.fromString(result.idempotencyKey().substring(result.idempotencyKey().indexOf(':') + 1));
		List<Map<String, Object>> rows = system.queryForList("""
				SELECT u.family_id, u.family_book_id, u.family_chapter_id, u.status, fb.upload_mode, s.name AS subject
				  FROM app.uploads u
				  JOIN app.family_books fb ON fb.id = u.family_book_id
				  JOIN app.subjects s ON s.id = fb.subject_id
				 WHERE u.id = ? FOR UPDATE OF u""", uploadId);
		if (rows.isEmpty() || !"scanning".equals(rows.get(0).get("status"))) {
			// Deleted meanwhile (chapter or book removed), or already settled
			log.info("Scan result ignored uploadId={}", uploadId);
			return;
		}
		Map<String, Object> upload = rows.get(0);
		UUID familyId = (UUID) upload.get("family_id");
		UUID chapterId = (UUID) upload.get("family_chapter_id");
		String subject = (String) upload.get("subject");
		if (!result.succeeded()) {
			system.update("UPDATE app.uploads SET status = 'failed' WHERE id = ?", uploadId);
			needsAttention(system, chapterId);
			message(system, familyId, (UUID) upload.get("family_book_id"), "We could not check your upload",
					"We could not check the pages you uploaded for " + subject + ". Please upload them again.");
			log.warn("Upload scan failed uploadId={}", uploadId);
			return;
		}
		List<String> infected = new ArrayList<>();
		for (JsonNode file : result.result().path("files")) {
			String key = file.path("object_key").asString();
			boolean bad = "infected".equals(file.path("result").asString());
			system.update("UPDATE app.upload_files SET scan_status = ? WHERE upload_id = ? AND object_key = ?",
					bad ? "infected" : "clean", uploadId, key);
			if (bad) {
				infected.add(key);
			}
		}
		if (!infected.isEmpty() || result.result().path("infected").asBoolean()) {
			system.update("UPDATE app.uploads SET status = 'rejected', reject_reason = 'infected' WHERE id = ?",
					uploadId);
			needsAttention(system, chapterId);
			message(system, familyId, (UUID) upload.get("family_book_id"), "Upload not used",
					"A file you uploaded for " + subject
							+ " looked unsafe, so we did not use it. Please upload the pages again.");
			deleteAfterCommit(system.queryForList("SELECT object_key FROM app.upload_files WHERE upload_id = ?",
					String.class, uploadId));
			log.warn("Upload infected uploadId={} files={}", uploadId, infected.size());
			return;
		}
		system.update("UPDATE app.uploads SET status = 'processing' WHERE id = ?", uploadId);
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("upload_id", uploadId);
		payload.put("family_book_id", upload.get("family_book_id"));
		payload.put("family_chapter_id", chapterId);
		payload.put("mode", upload.get("upload_mode"));
		jobs.publish(JobQueue.BOOK_PROCESS, PROCESS_JOB, PROCESS_JOB + ":" + uploadId, payload);
		log.info("Upload clean uploadId={}", uploadId);
	}

	private static void needsAttention(JdbcTemplate system, UUID chapterId) {
		if (chapterId != null) {
			system.update("UPDATE app.family_chapters SET status = 'needs_attention' WHERE id = ?", chapterId);
		}
	}

	/** An upload_problem message that opens the book on P4 (Schema §4.6 messages). */
	private static void message(JdbcTemplate system, UUID familyId, UUID bookId, String title, String body) {
		system.update("""
				INSERT INTO app.messages (family_id, kind, title, body, link)
				VALUES (?, 'upload_problem', ?, ?, CAST(? AS jsonb))""", familyId, title, body,
				JSON.writeValueAsString(Map.of("screen", "P4", "family_book_id", bookId)));
	}

	private void deleteAfterCommit(List<String> keys) {
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCommit() {
				try {
					storage.delete(keys);
				}
				catch (RuntimeException ex) {
					log.warn("Could not delete {} infected files: {}", keys.size(), ex.getClass().getSimpleName());
				}
			}
		});
	}

}
