package com.fullstar.api.studio.check;

import com.fullstar.api.common.jobs.JobPublisher;
import com.fullstar.api.common.jobs.JobQueue;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Queues lesson-narrate when a lesson is published (Schema §12; Plan 8.2, decided 22 Oct 2026): the
 * published version's narration scenes, in order, unless that version already has narration. Each
 * run has its own key, so publishing again after a failed run narrates again.
 */
@Component
public class LessonNarrationJobs {

	private static final Logger log = LoggerFactory.getLogger(LessonNarrationJobs.class);

	public static final String NARRATE_JOB = "lesson.narrate";

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JobPublisher jobs;

	public LessonNarrationJobs(JobPublisher jobs) {
		this.jobs = jobs;
	}

	/** Answers whether a job was queued. */
	public boolean queueIfNeeded(JdbcTemplate jdbc, UUID itemId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT ci.lang, v.id AS version_id, v.version_no, v.body::text AS body
				  FROM app.content_items ci JOIN app.content_versions v ON v.id = ci.published_version_id
				 WHERE ci.id = ? AND ci.kind = 'lesson' AND v.narration_audio_key IS NULL""", itemId);
		if (rows.isEmpty()) {
			return false;
		}
		Map<String, Object> row = rows.get(0);
		String lang = (String) row.get("lang");
		List<Map<String, String>> scenes = new ArrayList<>();
		for (JsonNode scene : JSON.readTree((String) row.get("body")).path("scenes")) {
			String text = scene.path("text").asString("");
			if (!text.isBlank()) {
				scenes.add(Map.of("id", scene.path("id").asString(), "text", text, "lang", lang));
			}
		}
		if (scenes.isEmpty()) {
			return false;
		}
		UUID versionId = (UUID) row.get("version_id");
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("content_version_id", versionId);
		payload.put("item_id", itemId);
		payload.put("version_no", ((Number) row.get("version_no")).intValue());
		payload.put("scenes", scenes);
		jobs.publish(JobQueue.LESSON_NARRATE, NARRATE_JOB, NARRATE_JOB + ":" + versionId + ":" + UUID.randomUUID(),
				payload);
		log.info("Lesson narration queued itemId={} versionId={} scenes={}", itemId, versionId, scenes.size());
		return true;
	}

}
