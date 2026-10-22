package com.fullstar.api.family.kid;

import com.fullstar.api.common.error.NotFoundException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Kid mode Learn (App Flow K1–K3; Schema §11; Plan 6.1). A subject shows "My book" once a chapter of
 * the child's book is ready to read along; until then (and without a book) it shows the class's
 * grade-level topics ("Class 3 practice"). Chapters still being processed are never shown. A
 * chapter's lesson card is "Coming soon" until its catalog chapter has a published lesson;
 * read-along works meanwhile. RLS keeps everything to the family; the child comes from X-Child-Id.
 */
@Service
public class KidLearnService {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	/** Family chapter statuses a child may open (App Flow §9 K1). */
	private static final String READY = "('readalong_ready', 'lessons_being_prepared', 'lessons_ready')";

	/** "Today" in Asia/Kolkata (Schema §1). */
	private static final String TODAY_START = "date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'";

	private final JdbcTemplate jdbc;

	public KidLearnService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Child(UUID id, String firstName, int classLevel, String avatarKey) {
	}

	/** mode: book (a ready chapter of the child's book) or practice (grade-level topics). */
	public record SubjectTile(int subjectId, String code, String name, String mode) {
	}

	/** Something left halfway: open it to carry on (K1 Continue card). */
	public record ContinueCard(UUID attemptId, String kind, int subjectId, String subject, UUID contentItemId,
			String title, UUID familyChapterId, UUID topicId, JsonNode resumeState) {
	}

	public record Home(Child child, int stars, int minutesToday, int dailyLimitMinutes, List<SubjectTile> subjects,
			ContinueCard continueCard) {
	}

	/** One K2 row: a chapter of the book or a grade-level topic, ticked when its lesson is finished. */
	public record Entry(UUID id, Integer number, String title, boolean done) {
	}

	public record Subject(int subjectId, String code, String name, String mode, List<Entry> entries) {
	}

	public record LessonCard(UUID contentItemId, String title, Integer durationSeconds, boolean done) {
	}

	/**
	 * K3. kind: chapter or topic. lessons empty → the Watch lesson card is "Coming soon". readAlong:
	 * uploaded chapters only. worksheet: when there are published questions to practise.
	 */
	public record Activity(String kind, UUID id, String title, Integer number, int subjectId, String subject,
			List<LessonCard> lessons, boolean readAlong, boolean worksheet) {
	}

	public Home home(UUID childId) {
		Child child = child(childId);
		Map<String, Object> totals = jdbc.queryForMap("""
				SELECT c.stars_total, f.daily_limit_minutes,
				       (SELECT count(*) FROM app.usage_minutes u WHERE u.child_id = c.id AND u.minute_at >= %s) AS minutes
				  FROM app.children c JOIN app.families f ON f.id = c.family_id WHERE c.id = ?""".formatted(TODAY_START),
				childId);
		List<SubjectTile> subjects = jdbc.query("""
				SELECT s.id, s.code, s.name,
				       EXISTS (SELECT 1 FROM app.child_books cb
				                 JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
				                WHERE cb.child_id = ? AND cb.subject_id = s.id AND fc.status IN %s) AS has_book
				  FROM app.class_subjects cs JOIN app.subjects s ON s.id = cs.subject_id
				 WHERE cs.class_level = ? AND s.active ORDER BY s.id""".formatted(READY),
				(rs, n) -> new SubjectTile(rs.getInt("id"), rs.getString("code"), rs.getString("name"),
						rs.getBoolean("has_book") ? "book" : "practice"),
				childId, child.classLevel());
		List<ContinueCard> open = jdbc.query("""
				SELECT a.id, a.kind, a.subject_id, s.code, a.content_item_id, cv.title, a.family_chapter_id, a.topic_id,
				       a.resume_state::text AS resume_state
				  FROM app.activity_attempts a
				  JOIN app.subjects s ON s.id = a.subject_id
				  LEFT JOIN app.content_items ci ON ci.id = a.content_item_id
				  LEFT JOIN app.content_versions cv ON cv.id = ci.published_version_id
				 WHERE a.child_id = ? AND a.completed_at IS NULL AND a.kind IN ('lesson', 'readalong')
				 ORDER BY a.started_at DESC LIMIT 1""",
				(rs, n) -> new ContinueCard(rs.getObject("id", UUID.class), rs.getString("kind"), rs.getInt("subject_id"),
						rs.getString("code"), rs.getObject("content_item_id", UUID.class), rs.getString("title"),
						rs.getObject("family_chapter_id", UUID.class), rs.getObject("topic_id", UUID.class),
						rs.getString("resume_state") == null ? null : JSON.readTree(rs.getString("resume_state"))),
				childId);
		return new Home(child, ((Number) totals.get("stars_total")).intValue(),
				((Number) totals.get("minutes")).intValue(), ((Number) totals.get("daily_limit_minutes")).intValue(),
				subjects, open.isEmpty() ? null : open.get(0));
	}

	public Subject subject(UUID childId, int subjectId) {
		Child child = child(childId);
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT s.code, s.name FROM app.class_subjects cs JOIN app.subjects s ON s.id = cs.subject_id
				 WHERE cs.class_level = ? AND s.id = ? AND s.active""", child.classLevel(), subjectId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		String code = (String) rows.get(0).get("code");
		String name = (String) rows.get(0).get("name");
		List<Entry> chapters = jdbc.query("""
				SELECT fc.id, fc.number, fc.title,
				       EXISTS (SELECT 1 FROM app.activity_attempts a WHERE a.child_id = cb.child_id AND a.kind = 'lesson'
				                  AND a.family_chapter_id = fc.id AND a.completed_at IS NOT NULL) AS done
				  FROM app.child_books cb
				  JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
				 WHERE cb.child_id = ? AND cb.subject_id = ? AND fc.status IN %s
				 ORDER BY fc.number""".formatted(READY),
				(rs, n) -> new Entry(rs.getObject("id", UUID.class), rs.getInt("number"), rs.getString("title"),
						rs.getBoolean("done")),
				childId, subjectId);
		if (!chapters.isEmpty()) {
			return new Subject(subjectId, code, name, "book", chapters);
		}
		List<Entry> topics = jdbc.query("""
				SELECT t.id, t.name,
				       EXISTS (SELECT 1 FROM app.activity_attempts a WHERE a.child_id = ? AND a.kind = 'lesson'
				                  AND a.topic_id = t.id AND a.completed_at IS NOT NULL) AS done
				  FROM app.topics t
				 WHERE t.class_level = ? AND t.subject_id = ? AND t.parent_id IS NULL AND t.archived_at IS NULL
				 ORDER BY t.sort_order, t.name""",
				(rs, n) -> new Entry(rs.getObject("id", UUID.class), null, rs.getString("name"), rs.getBoolean("done")),
				childId, child.classLevel(), subjectId);
		return new Subject(subjectId, code, name, "practice", topics);
	}

	public Activity chapter(UUID childId, UUID familyChapterId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT fc.id, fc.number, fc.title, fc.catalog_chapter_id, s.id AS subject_id, s.code
				  FROM app.child_books cb
				  JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
				  JOIN app.subjects s ON s.id = cb.subject_id
				 WHERE cb.child_id = ? AND fc.id = ? AND fc.status IN %s""".formatted(READY), childId,
				familyChapterId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		UUID catalogChapterId = (UUID) row.get("catalog_chapter_id");
		List<LessonCard> lessons = catalogChapterId == null ? List.of()
				: lessons(childId, "ci.catalog_chapter_id = ?", catalogChapterId);
		return new Activity("chapter", familyChapterId, (String) row.get("title"), (Integer) row.get("number"),
				((Number) row.get("subject_id")).intValue(), (String) row.get("code"), lessons, true,
				catalogChapterId != null && hasQuestions("ci.catalog_chapter_id = ?", catalogChapterId));
	}

	public Activity topic(UUID childId, UUID topicId) {
		Child child = child(childId);
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT t.id, t.name, s.id AS subject_id, s.code FROM app.topics t JOIN app.subjects s ON s.id = t.subject_id
				 WHERE t.id = ? AND t.class_level = ? AND t.archived_at IS NULL""", topicId, child.classLevel());
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		// A topic's content includes its sub-topics'
		String inTopic = """
				ci.scope = 'library' AND ci.topic_id IN (
				  WITH RECURSIVE tree AS (SELECT id FROM app.topics WHERE id = ?
				                          UNION ALL SELECT t.id FROM app.topics t JOIN tree ON t.parent_id = tree.id
				                           WHERE t.archived_at IS NULL)
				  SELECT id FROM tree)""";
		return new Activity("topic", topicId, (String) row.get("name"), null,
				((Number) row.get("subject_id")).intValue(), (String) row.get("code"),
				lessons(childId, inTopic, topicId), false, hasQuestions(inTopic, topicId));
	}

	private List<LessonCard> lessons(UUID childId, String where, UUID id) {
		return jdbc.query("""
				SELECT ci.id, cv.title, cv.duration_seconds,
				       EXISTS (SELECT 1 FROM app.activity_attempts a WHERE a.child_id = ? AND a.content_item_id = ci.id
				                  AND a.completed_at IS NOT NULL) AS done
				  FROM app.content_items ci JOIN app.content_versions cv ON cv.id = ci.published_version_id
				 WHERE ci.kind = 'lesson' AND ci.status = 'published' AND\s""" + where + " ORDER BY ci.published_at, ci.id",
				(rs, n) -> new LessonCard(rs.getObject("id", UUID.class), rs.getString("title"),
						(Integer) rs.getObject("duration_seconds"), rs.getBoolean("done")),
				childId, id);
	}

	private boolean hasQuestions(String where, UUID id) {
		Boolean any = jdbc.queryForObject("""
				SELECT EXISTS (SELECT 1 FROM app.content_items ci
				                WHERE ci.kind = 'question' AND ci.status = 'published' AND\s""" + where + ")", Boolean.class,
				id);
		return Boolean.TRUE.equals(any);
	}

	private Child child(UUID childId) {
		List<Child> children = jdbc.query(
				"SELECT id, first_name, class_level, avatar_key FROM app.children WHERE id = ?",
				(rs, n) -> new Child(rs.getObject("id", UUID.class), rs.getString("first_name"), rs.getInt("class_level"),
						rs.getString("avatar_key")),
				childId);
		if (children.isEmpty()) {
			throw new NotFoundException();
		}
		return children.get(0);
	}

}
