package com.fullstar.api.family.books;

import com.fullstar.api.common.jobs.JobResult;
import com.fullstar.api.common.jobs.JobResultHandler;
import com.fullstar.api.common.storage.FileStorage;
import java.math.BigDecimal;
import java.util.ArrayList;
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
 * Applies book-reader's book-process result (Schema §4.3, §12; Plan 5.3), once per job, as
 * app_system. The pages come from pages.json in storage (the job result only names it).
 * <ul>
 * <li>A retake replaces just its page; the chapter is fine again once no page is unclear.</li>
 * <li>A chapter upload fills its chapter (replacing earlier pages); unclear pages put it in
 * needs_attention with a pages_unclear message (P8).</li>
 * <li>A whole book gets its suggested chapters (status suggested) for the parent to check in P6.</li>
 * </ul>
 */
@Component
public class BookProcessResultHandler implements JobResultHandler {

	private static final Logger log = LoggerFactory.getLogger(BookProcessResultHandler.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final FileStorage storage;

	private final ReadAlongJobs readAlong;

	public BookProcessResultHandler(FileStorage storage, ReadAlongJobs readAlong) {
		this.storage = storage;
		this.readAlong = readAlong;
	}

	@Override
	public String type() {
		return UploadScanResultHandler.PROCESS_JOB;
	}

	private record Upload(UUID id, UUID familyId, UUID bookId, UUID chapterId, UUID retakePageId, String mode,
			String subject) {
	}

	@Override
	public void apply(JobResult result, JdbcTemplate system) {
		UUID uploadId = UUID.fromString(result.idempotencyKey().substring(result.idempotencyKey().indexOf(':') + 1));
		List<Map<String, Object>> rows = system.queryForList("""
				SELECT u.family_id, u.family_book_id, u.family_chapter_id, u.retake_page_id, u.status, fb.upload_mode,
				       s.name AS subject
				  FROM app.uploads u
				  JOIN app.family_books fb ON fb.id = u.family_book_id
				  JOIN app.subjects s ON s.id = fb.subject_id
				 WHERE u.id = ? FOR UPDATE OF u""", uploadId);
		if (rows.isEmpty() || !"processing".equals(rows.get(0).get("status"))) {
			log.info("Process result ignored uploadId={}", uploadId);
			return;
		}
		Map<String, Object> row = rows.get(0);
		Upload upload = new Upload(uploadId, (UUID) row.get("family_id"), (UUID) row.get("family_book_id"),
				(UUID) row.get("family_chapter_id"), (UUID) row.get("retake_page_id"), (String) row.get("upload_mode"),
				(String) row.get("subject"));
		if (!result.succeeded()) {
			system.update("UPDATE app.uploads SET status = 'failed' WHERE id = ?", uploadId);
			needsAttention(system, upload.chapterId());
			UploadScanResultHandler.message(system, upload.familyId(), "upload_problem", "We could not read your upload",
					"We could not read the pages you uploaded for " + upload.subject() + ". Please upload them again.",
					Map.of("screen", "P4", "family_book_id", upload.bookId()));
			log.warn("Book processing failed uploadId={}", uploadId);
			return;
		}
		String rejected = result.result().path("rejected").asString(null);
		if (rejected != null) {
			reject(system, upload, rejected);
			return;
		}
		JsonNode full = JSON.readTree(storage.read(result.result().path("result_key").asString()));
		List<JsonNode> pages = new ArrayList<>();
		full.path("pages").forEach(pages::add);
		if (upload.retakePageId() != null) {
			retake(system, upload, pages.get(0));
		}
		else if (upload.chapterId() != null) {
			fillChapter(system, upload, upload.chapterId(), pages);
		}
		else {
			splitBook(system, upload, pages, full.path("suggested_chapters"));
		}
		system.update("UPDATE app.uploads SET status = 'processed' WHERE id = ?", uploadId);
		log.info("Book processed uploadId={} pages={}", uploadId, pages.size());
	}

	private void retake(JdbcTemplate system, Upload upload, JsonNode page) {
		List<String> old = oldFiles(system, "id", upload.retakePageId());
		boolean unclear = "unclear".equals(page.path("quality").asString());
		system.update("""
				UPDATE app.pages
				   SET image_key = ?, ocr_text = ?, ocr_confidence = ?, quality = ?, upload_file_id = ?,
				       narration_audio_key = NULL, word_timings = NULL, updated_at = now()
				 WHERE id = ?""", page.path("image_key").asString(), page.path("text").asString(),
				confidence(page), unclear ? "unclear" : "retaken", UUID.fromString(page.path("file_id").asString()),
				upload.retakePageId());
		deleteAfterCommit(old);
		Integer left = system.queryForObject(
				"SELECT count(*) FROM app.pages WHERE family_chapter_id = ? AND quality = 'unclear'", Integer.class,
				upload.chapterId());
		if (left != null && left == 0) {
			system.update("""
					UPDATE app.family_chapters SET status = 'processing'
					 WHERE id = ? AND status = 'needs_attention'""", upload.chapterId());
			// The new page (or, after the last retake, the whole chapter) is read aloud (Plan 5.4)
			readAlong.queueIfReady(system, upload.chapterId());
		}
	}

	private void fillChapter(JdbcTemplate system, Upload upload, UUID chapterId, List<JsonNode> pages) {
		deleteAfterCommit(oldFiles(system, "family_chapter_id", chapterId));
		system.update("DELETE FROM app.pages WHERE family_chapter_id = ?", chapterId);
		int unclear = insertPages(system, upload, chapterId, pages, 0, pages.size());
		system.update("UPDATE app.family_chapters SET page_count = ?, status = ? WHERE id = ?", pages.size(),
				unclear > 0 ? "needs_attention" : "processing", chapterId);
		if (unclear > 0) {
			unclearMessage(system, upload, chapterId);
		}
		else {
			readAlong.queueIfReady(system, chapterId);
		}
	}

	/** Page images and narration of the pages being replaced. column is "id" or "family_chapter_id". */
	private static List<String> oldFiles(JdbcTemplate system, String column, UUID id) {
		List<String> keys = new ArrayList<>();
		system.query("SELECT image_key, narration_audio_key FROM app.pages WHERE " + column + " = ?", rs -> {
			keys.add(rs.getString("image_key"));
			if (rs.getString("narration_audio_key") != null) {
				keys.add(rs.getString("narration_audio_key"));
			}
		}, id);
		return keys;
	}

	/** Suggested chapters with their pages; start_page counts over the whole upload. */
	private void splitBook(JdbcTemplate system, Upload upload, List<JsonNode> pages, JsonNode suggested) {
		List<JsonNode> chapters = new ArrayList<>();
		suggested.forEach(chapters::add);
		if (chapters.isEmpty()) {
			chapters.add(JSON.valueToTree(Map.of("number", 1, "title", "Chapter 1", "start_page", 1)));
		}
		for (int i = 0; i < chapters.size(); i++) {
			JsonNode chapter = chapters.get(i);
			int from = Math.max(0, chapter.path("start_page").asInt(1) - 1);
			int to = i + 1 < chapters.size() ? chapters.get(i + 1).path("start_page").asInt() - 1 : pages.size();
			UUID chapterId = system.queryForObject("""
					INSERT INTO app.family_chapters (family_book_id, family_id, number, title, status, page_count)
					VALUES (?, ?, ?, ?, 'suggested', ?) RETURNING id""", UUID.class, upload.bookId(), upload.familyId(),
					chapter.path("number").asInt(i + 1), chapter.path("title").asString("Chapter " + (i + 1)),
					Math.max(0, to - from));
			insertPages(system, upload, chapterId, pages, from, to);
		}
		UploadScanResultHandler.message(system, upload.familyId(), "system", "Check the chapters",
				"We read your " + upload.subject() + " book and split it into " + chapters.size()
						+ (chapters.size() == 1 ? " chapter" : " chapters") + ". Please check them.",
				Map.of("screen", "P6", "family_book_id", upload.bookId()));
	}

	/** Inserts pages [from, to) of the upload into the chapter, numbered from 1; answers the unclear count. */
	private static int insertPages(JdbcTemplate system, Upload upload, UUID chapterId, List<JsonNode> pages, int from,
			int to) {
		int unclear = 0;
		for (int i = from; i < to; i++) {
			JsonNode page = pages.get(i);
			boolean isUnclear = "unclear".equals(page.path("quality").asString());
			unclear += isUnclear ? 1 : 0;
			system.update("""
					INSERT INTO app.pages (id, family_chapter_id, family_id, upload_file_id, page_no, image_key, ocr_text,
					                       ocr_confidence, quality)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", UUID.fromString(page.path("page_id").asString()), chapterId,
					upload.familyId(), UUID.fromString(page.path("file_id").asString()), i - from + 1,
					page.path("image_key").asString(), page.path("text").asString(), confidence(page),
					isUnclear ? "unclear" : "ok");
		}
		return unclear;
	}

	private void reject(JdbcTemplate system, Upload upload, String reason) {
		system.update("UPDATE app.uploads SET status = 'rejected', reject_reason = ? WHERE id = ?", reason, upload.id());
		needsAttention(system, upload.chapterId());
		String body = "too_many_pages".equals(reason)
				? "The PDF you uploaded for " + upload.subject() + " has more than 300 pages. Please upload it in parts, chapter by chapter."
				: "We could not open the file you uploaded for " + upload.subject() + ". Please upload it again.";
		UploadScanResultHandler.message(system, upload.familyId(), "upload_problem", "Upload not used", body,
				Map.of("screen", "P4", "family_book_id", upload.bookId()));
		log.info("Upload rejected uploadId={} reason={}", upload.id(), reason);
	}

	static void needsAttention(JdbcTemplate system, UUID chapterId) {
		if (chapterId != null) {
			system.update("UPDATE app.family_chapters SET status = 'needs_attention' WHERE id = ?", chapterId);
		}
	}

	/** Schema §11 note: any unclear page → chapter needs_attention, message pages_unclear (P8). */
	static void unclearMessage(JdbcTemplate system, Upload upload, UUID chapterId) {
		Integer number = system.queryForObject("SELECT number FROM app.family_chapters WHERE id = ?", Integer.class,
				chapterId);
		UploadScanResultHandler.message(system, upload.familyId(), "pages_unclear", "Some pages are unclear",
				"Some pages of " + upload.subject() + " chapter " + number
						+ " are hard to read. Please take new photos of them.",
				Map.of("screen", "P8", "family_chapter_id", chapterId));
	}

	private static BigDecimal confidence(JsonNode page) {
		return BigDecimal.valueOf(Math.max(0, Math.min(100, page.path("confidence").asDouble())))
			.setScale(2, java.math.RoundingMode.HALF_UP);
	}

	private void deleteAfterCommit(List<String> keys) {
		if (keys.isEmpty()) {
			return;
		}
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCommit() {
				try {
					storage.delete(keys);
				}
				catch (RuntimeException ex) {
					log.warn("Could not delete {} old page images: {}", keys.size(), ex.getClass().getSimpleName());
				}
			}
		});
	}

}
