package com.fullstar.api.family.books;

import com.fullstar.api.common.jobs.JobResult;
import com.fullstar.api.common.jobs.JobResultHandler;
import com.fullstar.api.common.storage.FileStorage;
import com.fullstar.api.common.storage.StorageKeys;
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
 * Applies a readalong-narrate result (Schema §8.4, §12; Plan 5.4), once per job, as app_system.
 * Each page gets its audio key and word timings. When every page of a processing chapter has
 * narration, the chapter is readalong_ready, the parent gets a readalong_ready message and, unless
 * a ready catalog chapter is linked, a prep task is opened for the Studio queue.
 */
@Component
public class ReadAlongResultHandler implements JobResultHandler {

	private static final Logger log = LoggerFactory.getLogger(ReadAlongResultHandler.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final FileStorage storage;

	public ReadAlongResultHandler(FileStorage storage) {
		this.storage = storage;
	}

	@Override
	public String type() {
		return ReadAlongJobs.NARRATE_JOB;
	}

	@Override
	public void apply(JobResult result, JdbcTemplate system) {
		// Keys are "readalong.narrate:<chapter id>:<run id>"
		String[] key = result.idempotencyKey().split(":");
		if (key.length != 3) {
			log.warn("Read-along result with an unknown key ignored");
			return;
		}
		UUID chapterId = UUID.fromString(key[1]);
		UUID runId = UUID.fromString(key[2]);
		List<Map<String, Object>> rows = system.queryForList("""
				SELECT c.family_id, c.family_book_id, c.number, c.status, s.name AS subject, cc.status AS catalog_status,
				       c.catalog_chapter_id
				  FROM app.family_chapters c
				  JOIN app.family_books fb ON fb.id = c.family_book_id
				  JOIN app.subjects s ON s.id = fb.subject_id
				  LEFT JOIN app.catalog_chapters cc ON cc.id = c.catalog_chapter_id
				 WHERE c.id = ? FOR UPDATE OF c""", chapterId);
		if (rows.isEmpty()) {
			log.info("Read-along result ignored, chapter gone chapterId={}", chapterId);
			return;
		}
		Map<String, Object> chapter = rows.get(0);
		UUID familyId = (UUID) chapter.get("family_id");
		String inputKey = StorageKeys.narration(familyId, chapterId, runId, "input");
		if (!result.succeeded()) {
			// Not something the parent can fix: the job is in the DLQ for the team; the chapter stays getting ready
			log.error("Read-along narration failed chapterId={}", chapterId);
			deleteAfterCommit(List.of(inputKey));
			return;
		}
		String resultKey = result.result().path("result_key").asString();
		if (!resultKey.equals(StorageKeys.narration(familyId, chapterId, runId, "result"))) {
			throw new IllegalStateException("Read-along result key does not belong to the chapter");
		}
		JsonNode full = JSON.readTree(storage.read(resultKey));
		String audioPrefix = StorageKeys.familyPrefix(familyId) + "audio/";
		int applied = 0;
		for (JsonNode page : full.path("pages")) {
			String audioKey = page.path("audio_key").asString();
			if (!audioKey.startsWith(audioPrefix) || audioKey.contains("..")) {
				throw new IllegalStateException("Read-along audio key outside the family");
			}
			// Pages replaced meanwhile (a new upload) are simply not there any more
			applied += system.update("""
					UPDATE app.pages SET narration_audio_key = ?, word_timings = CAST(? AS jsonb), updated_at = now()
					 WHERE id = ? AND family_chapter_id = ?""", audioKey,
					JSON.writeValueAsString(page.path("word_timings")), UUID.fromString(page.path("page_id").asString()),
					chapterId);
		}
		deleteAfterCommit(List.of(inputKey, resultKey));
		int ready = system.update("""
				UPDATE app.family_chapters c SET status = 'readalong_ready', updated_at = now()
				 WHERE id = ? AND status = 'processing' AND page_count > 0
				   AND NOT EXISTS (SELECT 1 FROM app.pages p WHERE p.family_chapter_id = c.id
				                    AND (p.narration_audio_key IS NULL OR p.quality = 'unclear'))""", chapterId);
		log.info("Read-along applied chapterId={} pages={} ready={}", chapterId, applied, ready == 1);
		if (ready == 0) {
			return;
		}
		UploadScanResultHandler.message(system, familyId, "readalong_ready", "Ready to read along",
				chapter.get("subject") + " Ch " + chapter.get("number") + " is ready to read along.",
				Map.of("screen", "P4", "family_book_id", chapter.get("family_book_id")));
		if (!"ready".equals(chapter.get("catalog_status"))) {
			system.update("""
					INSERT INTO app.prep_tasks (family_chapter_id, catalog_chapter_id) VALUES (?, ?)
					ON CONFLICT (family_chapter_id) WHERE status IN ('open', 'in_progress') DO NOTHING""", chapterId,
					chapter.get("catalog_chapter_id"));
		}
	}

	private void deleteAfterCommit(List<String> keys) {
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCommit() {
				try {
					storage.delete(keys);
				}
				catch (RuntimeException ex) {
					log.warn("Could not delete {} narration files: {}", keys.size(), ex.getClass().getSimpleName());
				}
			}
		});
	}

}
