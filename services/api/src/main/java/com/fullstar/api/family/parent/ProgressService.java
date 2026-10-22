package com.fullstar.api.family.parent;

import com.fullstar.api.common.error.NotFoundException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Parent progress (App Flow P1, P2; Schema §7 child_week_summary, §11; Plan 6.4). Weeks start on
 * Monday in Asia/Kolkata. One child at a time, never compared. RLS keeps it to the family.
 */
@Service
public class ProgressService {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

	private final JdbcTemplate jdbc;

	public ProgressService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** One subject on P1: chapters of the book done (lesson finished) and lessons finished this week. */
	public record SubjectProgress(int subjectId, String code, String name, int chaptersDone, int chaptersTotal,
			int lessonsDone) {
	}

	/** areas: up to three topics to work on, {topic_id, name, subject, score}. */
	public record Week(LocalDate start, int minutes, int activeDays, int chaptersDone, int worksheetsDone,
			JsonNode areas, List<SubjectProgress> subjects, boolean anyActivity) {
	}

	public record ChapterDone(UUID id, int number, String title, boolean done) {
	}

	public record TopicAccuracy(UUID topicId, String name, int correct, int answered) {
	}

	public record WeakSpot(UUID topicId, String name, int ticks) {
	}

	public record SubjectDetail(int subjectId, String code, String name, List<ChapterDone> chapters,
			List<TopicAccuracy> accuracy, List<WeakSpot> weakSpots) {
	}

	/** The Monday of today's week in India. */
	static LocalDate thisWeek() {
		return LocalDate.now(INDIA).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
	}

	public Week week(UUID childId, LocalDate start) {
		int classLevel = classOf(childId);
		LocalDate monday = start.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
		Map<String, Object> s = jdbc.queryForMap(
				"SELECT minutes, active_days, chapters_done, worksheets_done, areas::text AS areas FROM app.child_week_summary(?, ?)",
				childId, java.sql.Date.valueOf(monday));
		List<SubjectProgress> subjects = jdbc.query("""
				SELECT s.id, s.code, s.name,
				       (SELECT count(*) FROM app.child_books cb JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
				         WHERE cb.child_id = ? AND cb.subject_id = s.id
				           AND fc.status IN ('readalong_ready', 'lessons_being_prepared', 'lessons_ready')) AS total,
				       (SELECT count(DISTINCT a.family_chapter_id) FROM app.activity_attempts a
				         WHERE a.child_id = ? AND a.subject_id = s.id AND a.kind = 'lesson' AND a.completed_at IS NOT NULL
				           AND a.family_chapter_id IS NOT NULL) AS chapters_done,
				       (SELECT count(*) FROM app.activity_attempts a
				         WHERE a.child_id = ? AND a.subject_id = s.id AND a.kind = 'lesson' AND a.completed_at IS NOT NULL
				           AND a.completed_at >= (CAST(? AS date)::timestamp AT TIME ZONE 'Asia/Kolkata')
				           AND a.completed_at < ((CAST(? AS date) + 7)::timestamp AT TIME ZONE 'Asia/Kolkata')) AS lessons_done
				  FROM app.class_subjects cs JOIN app.subjects s ON s.id = cs.subject_id
				 WHERE cs.class_level = ? AND s.active ORDER BY s.id""",
				(rs, n) -> new SubjectProgress(rs.getInt("id"), rs.getString("code"), rs.getString("name"),
						rs.getInt("chapters_done"), rs.getInt("total"), rs.getInt("lessons_done")),
				childId, childId, childId, java.sql.Date.valueOf(monday), java.sql.Date.valueOf(monday), classLevel);
		Boolean any = jdbc.queryForObject("""
				SELECT EXISTS (SELECT 1 FROM app.activity_attempts WHERE child_id = ?)
				    OR EXISTS (SELECT 1 FROM app.usage_minutes WHERE child_id = ?)""", Boolean.class, childId, childId);
		return new Week(monday, ((Number) s.get("minutes")).intValue(), ((Number) s.get("active_days")).intValue(),
				((Number) s.get("chapters_done")).intValue(), ((Number) s.get("worksheets_done")).intValue(),
				JSON.readTree((String) s.get("areas")), subjects, Boolean.TRUE.equals(any));
	}

	public SubjectDetail subject(UUID childId, int subjectId) {
		int classLevel = classOf(childId);
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT s.code, s.name FROM app.class_subjects cs JOIN app.subjects s ON s.id = cs.subject_id
				 WHERE cs.class_level = ? AND s.id = ? AND s.active""", classLevel, subjectId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		List<ChapterDone> chapters = jdbc.query("""
				SELECT fc.id, fc.number, fc.title,
				       EXISTS (SELECT 1 FROM app.activity_attempts a WHERE a.child_id = cb.child_id AND a.kind = 'lesson'
				                  AND a.family_chapter_id = fc.id AND a.completed_at IS NOT NULL) AS done
				  FROM app.child_books cb JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
				 WHERE cb.child_id = ? AND cb.subject_id = ?
				   AND fc.status IN ('readalong_ready', 'lessons_being_prepared', 'lessons_ready')
				 ORDER BY fc.number""",
				(rs, n) -> new ChapterDone(rs.getObject("id", UUID.class), rs.getInt("number"), rs.getString("title"),
						rs.getBoolean("done")),
				childId, subjectId);
		// First answers only, so trying again until right does not raise accuracy
		List<TopicAccuracy> accuracy = jdbc.query("""
				SELECT t.id, t.name, count(*) FILTER (WHERE e.is_correct) AS correct, count(*) AS answered
				  FROM app.answer_events e JOIN app.topics t ON t.id = e.topic_id
				 WHERE e.child_id = ? AND t.subject_id = ?
				 GROUP BY t.id, t.name ORDER BY t.name""",
				(rs, n) -> new TopicAccuracy(rs.getObject("id", UUID.class), rs.getString("name"), rs.getInt("correct"),
						rs.getInt("answered")),
				childId, subjectId);
		List<WeakSpot> weak = jdbc.query("""
				SELECT t.id, t.name, count(*) AS ticks
				  FROM app.worksheet_weak_spots w JOIN app.topics t ON t.id = w.topic_id
				 WHERE w.child_id = ? AND t.subject_id = ? AND w.marked_at > now() - interval '30 days'
				 GROUP BY t.id, t.name ORDER BY ticks DESC, t.name""",
				(rs, n) -> new WeakSpot(rs.getObject("id", UUID.class), rs.getString("name"), rs.getInt("ticks")),
				childId, subjectId);
		return new SubjectDetail(subjectId, (String) rows.get(0).get("code"), (String) rows.get(0).get("name"),
				chapters, accuracy, weak);
	}

	/** RLS: another family's child is simply not found. */
	private int classOf(UUID childId) {
		List<Integer> classes = jdbc.queryForList("SELECT class_level FROM app.children WHERE id = ?", Integer.class,
				childId);
		if (classes.isEmpty()) {
			throw new NotFoundException();
		}
		return classes.get(0);
	}

}
