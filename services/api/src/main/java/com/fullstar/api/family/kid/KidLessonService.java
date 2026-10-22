package com.fullstar.api.family.kid;

import com.fullstar.api.common.error.NotFoundException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * K4 lesson for the player (Schema §11 GET /family/kid/lessons/{id}; Plan 6.2): the published version,
 * the published questions its quiz scenes name (with solutions, so the player can check answers
 * offline), and where the child left off. RLS lets a family read only content it is entitled to.
 */
@Service
public class KidLessonService {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JdbcTemplate jdbc;

	public KidLessonService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Question(UUID id, UUID versionId, String questionType, UUID topicId, JsonNode body,
			JsonNode solution) {
	}

	public record Resume(UUID attemptId, JsonNode resumeState) {
	}

	public record Lesson(UUID id, UUID versionId, String title, String lang, Integer durationSeconds, int subjectId,
			UUID topicId, UUID catalogChapterId, JsonNode body, List<Question> questions, Resume resume) {
	}

	public Lesson lesson(UUID childId, UUID contentItemId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT ci.id, ci.published_version_id, ci.lang, ci.subject_id, ci.topic_id, ci.catalog_chapter_id,
				       cv.title, cv.duration_seconds, cv.body::text AS body
				  FROM app.content_items ci JOIN app.content_versions cv ON cv.id = ci.published_version_id
				 WHERE ci.id = ? AND ci.kind = 'lesson' AND ci.status = 'published'""", contentItemId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		JsonNode body = JSON.readTree((String) row.get("body"));
		List<UUID> quizIds = new ArrayList<>();
		for (JsonNode scene : body.path("scenes")) {
			String id = scene.path("quiz").path("question_item_id").asString(null);
			if (id != null) {
				quizIds.add(UUID.fromString(id));
			}
		}
		// Quiz questions that were unpublished since are left out; the player skips their scenes
		List<Question> questions = quizIds.isEmpty() ? List.of() : jdbc.query("""
				SELECT ci.id, ci.published_version_id, ci.question_type, ci.topic_id, cv.body::text AS body,
				       cv.solution::text AS solution
				  FROM app.content_items ci JOIN app.content_versions cv ON cv.id = ci.published_version_id
				 WHERE ci.id = ANY (?) AND ci.kind = 'question' AND ci.status = 'published'""",
				(rs, n) -> new Question(rs.getObject("id", UUID.class), rs.getObject("published_version_id", UUID.class),
						rs.getString("question_type"), rs.getObject("topic_id", UUID.class),
						JSON.readTree(rs.getString("body")),
						rs.getString("solution") == null ? null : JSON.readTree(rs.getString("solution"))),
				(Object) quizIds.toArray(UUID[]::new));
		List<Resume> resume = jdbc.query("""
				SELECT id, resume_state::text AS resume_state FROM app.activity_attempts
				 WHERE child_id = ? AND content_item_id = ? AND kind = 'lesson' AND completed_at IS NULL
				 ORDER BY started_at DESC LIMIT 1""",
				(rs, n) -> new Resume(rs.getObject("id", UUID.class),
						rs.getString("resume_state") == null ? null : JSON.readTree(rs.getString("resume_state"))),
				childId, contentItemId);
		return new Lesson(contentItemId, (UUID) row.get("published_version_id"), (String) row.get("title"),
				(String) row.get("lang"), (Integer) row.get("duration_seconds"),
				((Number) row.get("subject_id")).intValue(), (UUID) row.get("topic_id"),
				(UUID) row.get("catalog_chapter_id"), body, questions, resume.isEmpty() ? null : resume.get(0));
	}

}
