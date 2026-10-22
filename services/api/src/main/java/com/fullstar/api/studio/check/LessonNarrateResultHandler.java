package com.fullstar.api.studio.check;

import com.fullstar.api.common.jobs.JobResult;
import com.fullstar.api.common.jobs.JobResultHandler;
import com.fullstar.api.common.storage.StorageKeys;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Applies a lesson-narrate result (Schema §12; Plan 8.2), once per job, as app_system: the version
 * gets its MP3 key and each scene's start and end in it. K4 plays a scene's part when the child
 * presses Read aloud; until then it uses the device voice. A failure stays in the DLQ for the team.
 */
@Component
public class LessonNarrateResultHandler implements JobResultHandler {

	private static final Logger log = LoggerFactory.getLogger(LessonNarrateResultHandler.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	@Override
	public String type() {
		return LessonNarrationJobs.NARRATE_JOB;
	}

	@Override
	public void apply(JobResult result, JdbcTemplate system) {
		// Keys are "lesson.narrate:<version id>:<run id>"
		String[] key = result.idempotencyKey().split(":");
		if (key.length != 3) {
			log.warn("Lesson narration result with an unknown key ignored");
			return;
		}
		UUID versionId = UUID.fromString(key[1]);
		List<Map<String, Object>> rows = system.queryForList("""
				SELECT item_id, version_no, body::text AS body FROM app.content_versions WHERE id = ? FOR UPDATE""",
				versionId);
		if (rows.isEmpty()) {
			log.info("Lesson narration ignored, version gone versionId={}", versionId);
			return;
		}
		if (!result.succeeded()) {
			log.error("Lesson narration failed versionId={}", versionId);
			return;
		}
		Map<String, Object> version = rows.get(0);
		String audioKey = result.result().path("audio_key").asString("");
		String expected = StorageKeys.content((UUID) version.get("item_id"),
				((Number) version.get("version_no")).intValue(), "narration.mp3");
		if (!audioKey.equals(expected)) {
			throw new IllegalStateException("Lesson narration key does not belong to the version");
		}
		JsonNode scenes = result.result().path("scenes");
		Set<String> known = new HashSet<>();
		for (JsonNode scene : JSON.readTree((String) version.get("body")).path("scenes")) {
			known.add(scene.path("id").asString(""));
		}
		if (!scenes.isArray() || scenes.isEmpty()) {
			throw new IllegalStateException("Lesson narration has no scenes");
		}
		for (JsonNode scene : scenes) {
			long start = scene.path("start_ms").asLong(-1);
			long end = scene.path("end_ms").asLong(-1);
			if (!known.contains(scene.path("id").asString("")) || start < 0 || end < start) {
				throw new IllegalStateException("Lesson narration scene times are not valid");
			}
		}
		system.update("""
				UPDATE app.content_versions SET narration_audio_key = ?, narration_timings = CAST(? AS jsonb)
				 WHERE id = ?""", audioKey, JSON.writeValueAsString(scenes), versionId);
		log.info("Lesson narration applied versionId={} scenes={}", versionId, scenes.size());
	}

}
