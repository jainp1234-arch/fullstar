package com.fullstar.api.family.lessons;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * P8a Preview new lessons (App Flow §6; Schema §4.3 lesson_previews, §11; Plan 5.5). A parent sees the
 * published lessons of an uploaded chapter with their questions, and answers Looks good or Report a
 * problem. A report also opens a problem_reports row for the team (S7; decided 22 Oct 2026). RLS lets
 * a parent read only published content of chapters linked to the family.
 */
@Service
public class LessonPreviewService {

	private static final Logger log = LoggerFactory.getLogger(LessonPreviewService.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JdbcTemplate jdbc;

	public LessonPreviewService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** previewResult: looks_good, reported, or null when not previewed yet ("New · preview recommended"). */
	public record LessonCard(UUID contentItemId, String title, Integer durationSeconds, String previewResult) {
	}

	public record Lesson(UUID id, String title, String lang, Integer durationSeconds, JsonNode body) {
	}

	public record Question(UUID id, String title, String questionType, int difficulty, JsonNode body,
			JsonNode solution) {
	}

	public record Preview(Lesson lesson, List<Question> questions, String previewResult) {
	}

	public List<LessonCard> chapterLessons(UUID familyChapterId) {
		Integer known = jdbc.queryForObject("SELECT count(*) FROM app.family_chapters WHERE id = ?", Integer.class,
				familyChapterId);
		if (known == null || known == 0) {
			throw new NotFoundException();
		}
		return jdbc.query("""
				SELECT ci.id, cv.title, cv.duration_seconds, lp.result
				  FROM app.family_chapters fc
				  JOIN app.content_items ci ON ci.catalog_chapter_id = fc.catalog_chapter_id
				  JOIN app.content_versions cv ON cv.id = ci.published_version_id
				  LEFT JOIN app.lesson_previews lp ON lp.content_item_id = ci.id
				 WHERE fc.id = ? AND ci.kind = 'lesson' AND ci.status = 'published'
				 ORDER BY ci.published_at, ci.id""",
				(rs, n) -> new LessonCard(rs.getObject("id", UUID.class), rs.getString("title"),
						(Integer) rs.getObject("duration_seconds"), rs.getString("result")),
				familyChapterId);
	}

	public Preview preview(UUID contentItemId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT ci.id, ci.lang, ci.catalog_chapter_id, ci.topic_id, cv.title, cv.duration_seconds, cv.body::text AS body,
				       lp.result
				  FROM app.content_items ci
				  JOIN app.content_versions cv ON cv.id = ci.published_version_id
				  LEFT JOIN app.lesson_previews lp ON lp.content_item_id = ci.id
				 WHERE ci.id = ? AND ci.kind = 'lesson' AND ci.status = 'published'""", contentItemId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		Lesson lesson = new Lesson(contentItemId, (String) row.get("title"), (String) row.get("lang"),
				(Integer) row.get("duration_seconds"), JSON.readTree((String) row.get("body")));
		UUID chapterId = (UUID) row.get("catalog_chapter_id");
		// A chapter lesson's questions are its chapter's question bank; a library lesson's, its topic's
		String scope = chapterId != null ? "ci.catalog_chapter_id = ?" : "ci.scope = 'library' AND ci.topic_id = ?";
		List<Question> questions = jdbc.query("""
				SELECT ci.id, cv.title, ci.question_type, ci.difficulty, cv.body::text AS body, cv.solution::text AS solution
				  FROM app.content_items ci
				  JOIN app.content_versions cv ON cv.id = ci.published_version_id
				 WHERE ci.kind = 'question' AND ci.status = 'published' AND\s""" + scope + """

				 ORDER BY ci.published_at, ci.id""",
				(rs, n) -> new Question(rs.getObject("id", UUID.class), rs.getString("title"),
						rs.getString("question_type"), rs.getInt("difficulty"), JSON.readTree(rs.getString("body")),
						rs.getString("solution") == null ? null : JSON.readTree(rs.getString("solution"))),
				chapterId != null ? chapterId : row.get("topic_id"));
		return new Preview(lesson, questions, (String) row.get("result"));
	}

	/** looks_good, or reported with a reason (Schema §4.6 problem_reports.reason) and an optional note. */
	public Preview record(RequestActor actor, UUID contentItemId, String result, String reason, String note) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT ci.published_version_id, lp.result
				  FROM app.content_items ci
				  LEFT JOIN app.lesson_previews lp ON lp.content_item_id = ci.id
				 WHERE ci.id = ? AND ci.kind = 'lesson' AND ci.status = 'published'""", contentItemId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		boolean reported = "reported".equals(result);
		if (reported && reason == null) {
			throw new ValidationException("reason is required", Map.of("reason", "REQUIRED"));
		}
		jdbc.update("""
				INSERT INTO app.lesson_previews (family_id, content_item_id, result) VALUES (?, ?, ?)
				ON CONFLICT (family_id, content_item_id) DO UPDATE SET result = EXCLUDED.result, created_at = now()""",
				actor.familyId(), contentItemId, result);
		// One open report per preview: reporting again only updates the preview
		if (reported && !"reported".equals(rows.get(0).get("result"))) {
			jdbc.update("""
					INSERT INTO app.problem_reports (family_id, content_item_id, content_version_id, reason, note)
					VALUES (?, ?, ?, ?, ?)""", actor.familyId(), contentItemId, rows.get(0).get("published_version_id"),
					reason, note);
			log.info("Lesson reported from preview contentItemId={} reason={}", contentItemId, reason);
		}
		return preview(contentItemId);
	}

}
