package com.fullstar.api.family.books;

import com.fullstar.api.common.jobs.JobPublisher;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.storage.FileStorage;
import com.fullstar.api.common.storage.StorageKeys;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Queues readalong-narrate for a chapter (Schema §12; Plan 5.4) once its pages are final: the
 * chapter is past the split and has no unclear page. Only pages without narration are sent. Their
 * text goes to storage (a 300-page chapter would pass the 256 KB SQS limit); the job names the file.
 */
@Component
public class ReadAlongJobs {

	private static final Logger log = LoggerFactory.getLogger(ReadAlongJobs.class);

	public static final String NARRATE_JOB = "readalong.narrate";

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JobPublisher jobs;

	private final FileStorage storage;

	public ReadAlongJobs(JobPublisher jobs, FileStorage storage) {
		this.jobs = jobs;
		this.storage = storage;
	}

	/**
	 * Queues narration when the chapter is ready for it. Works with the request's app_api template
	 * (RLS scopes it to the family) and the consumer's app_system one. Answers whether a job was queued.
	 */
	public boolean queueIfReady(JdbcTemplate jdbc, UUID chapterId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT c.family_id, c.status, s.code AS subject_code,
				       EXISTS (SELECT 1 FROM app.pages p WHERE p.family_chapter_id = c.id AND p.quality = 'unclear') AS unclear
				  FROM app.family_chapters c
				  JOIN app.family_books fb ON fb.id = c.family_book_id
				  JOIN app.subjects s ON s.id = fb.subject_id
				 WHERE c.id = ?""", chapterId);
		if (rows.isEmpty()) {
			return false;
		}
		Map<String, Object> chapter = rows.get(0);
		String status = (String) chapter.get("status");
		if (Boolean.TRUE.equals(chapter.get("unclear")) || "suggested".equals(status)
				|| "needs_attention".equals(status)) {
			return false;
		}
		List<Map<String, Object>> pages = jdbc.queryForList("""
				SELECT id AS page_id, COALESCE(ocr_text, '') AS text FROM app.pages
				 WHERE family_chapter_id = ? AND narration_audio_key IS NULL ORDER BY page_no""", chapterId);
		if (pages.isEmpty()) {
			return false;
		}
		UUID familyId = (UUID) chapter.get("family_id");
		UUID runId = UUID.randomUUID();
		String inputKey = StorageKeys.narration(familyId, chapterId, runId, "input");
		storage.put(inputKey, JSON.writeValueAsBytes(Map.of("pages", pages)), "application/json");
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("family_chapter_id", chapterId);
		payload.put("family_id", familyId);
		payload.put("run_id", runId);
		payload.put("lang", "hindi".equals(chapter.get("subject_code")) ? "hi" : "en");
		payload.put("page_count", pages.size());
		payload.put("pages_key", inputKey);
		jobs.publish(JobQueue.READALONG_NARRATE, NARRATE_JOB, NARRATE_JOB + ":" + chapterId + ":" + runId, payload);
		log.info("Read-along queued chapterId={} pages={}", chapterId, pages.size());
		return true;
	}

}
