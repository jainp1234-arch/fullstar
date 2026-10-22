package com.fullstar.api.family.kid;

import com.fullstar.api.common.error.NotFoundException;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/**
 * Kid mode Practice (App Flow K8, K9, K11; Schema §11; Plan 7.1). A practice set is 10 published
 * questions of the child's class and subject, shuffled each time: grade-level (library) questions
 * and those of the child's prepared book chapters. Fix my mistakes brings back the questions still
 * in the child's open mistakes; a question leaves them after 2 right answers in a row (trigger
 * track_mistakes on the answers synced from the device). Tables are made on the device.
 */
@Service
public class KidPracticeService {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	/** App Flow K9: 10 questions per set. */
	static final int SET_SIZE = 10;

	/** Published questions the child may practise: the class's library and the child's book chapters. */
	private static final String CHILD_QUESTIONS = """
			ci.kind = 'question' AND ci.status = 'published' AND ci.class_level = ? AND (ci.scope = 'library'
			  OR ci.catalog_chapter_id IN (SELECT fc.catalog_chapter_id FROM app.child_books cb
			                                 JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
			                                WHERE cb.child_id = ?))""";

	private static final String QUESTION = """
			SELECT ci.id, ci.published_version_id, ci.question_type, ci.topic_id, cv.body::text AS body,
			       cv.solution::text AS solution
			  FROM app.content_items ci JOIN app.content_versions cv ON cv.id = ci.published_version_id""";

	private final JdbcTemplate jdbc;

	public KidPracticeService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Topic(UUID id, String name, int questions) {
	}

	public record SubjectTile(int subjectId, String code, String name, int questions, List<Topic> topics) {
	}

	public record Home(List<SubjectTile> subjects, int mistakes) {
	}

	public record Set(String kind, int subjectId, UUID topicId, List<KidLessonService.Question> questions) {
	}

	public Home home(UUID childId) {
		int classLevel = classOf(childId);
		List<SubjectTile> subjects = jdbc.query("""
				SELECT s.id, s.code, s.name,
				       (SELECT count(*) FROM app.content_items ci WHERE ci.subject_id = s.id AND\s""" + CHILD_QUESTIONS + """
				) AS questions
				  FROM app.class_subjects cs JOIN app.subjects s ON s.id = cs.subject_id
				 WHERE cs.class_level = ? AND s.active ORDER BY s.id""",
				(rs, n) -> new SubjectTile(rs.getInt("id"), rs.getString("code"), rs.getString("name"),
						rs.getInt("questions"), topics(childId, classLevel, rs.getInt("id"))),
				classLevel, childId, classLevel);
		Integer mistakes = jdbc.queryForObject("""
				SELECT count(*) FROM app.mistakes m JOIN app.content_items ci ON ci.id = m.question_item_id
				 WHERE m.child_id = ? AND m.resolved_at IS NULL AND ci.status = 'published'""", Integer.class, childId);
		return new Home(subjects, mistakes == null ? 0 : mistakes);
	}

	/** 10 shuffled questions of the subject (and topic, with its sub-topics). Fewer if there are fewer. */
	public Set practiceSet(UUID childId, int subjectId, UUID topicId) {
		int classLevel = classOf(childId);
		Integer taught = jdbc.queryForObject("""
				SELECT count(*) FROM app.class_subjects cs JOIN app.subjects s ON s.id = cs.subject_id
				 WHERE cs.class_level = ? AND s.id = ? AND s.active""", Integer.class, classLevel, subjectId);
		if (taught == null || taught == 0) {
			throw new NotFoundException();
		}
		String topicFilter = topicId == null ? "" : """
				 AND ci.topic_id IN (WITH RECURSIVE tree AS (SELECT id FROM app.topics WHERE id = ?
				                     UNION ALL SELECT t.id FROM app.topics t JOIN tree ON t.parent_id = tree.id)
				                     SELECT id FROM tree)""";
		Object[] params = topicId == null ? new Object[] { subjectId, classLevel, childId, SET_SIZE }
				: new Object[] { subjectId, classLevel, childId, topicId, SET_SIZE };
		List<KidLessonService.Question> questions = jdbc.query(
				QUESTION + " WHERE ci.subject_id = ? AND " + CHILD_QUESTIONS + topicFilter + " ORDER BY random() LIMIT ?",
				KidPracticeService::question, params);
		return new Set("practice", subjectId, topicId, questions);
	}

	/** Open mistakes, oldest first, as a set (K11). */
	public Set mistakes(UUID childId) {
		List<KidLessonService.Question> questions = jdbc.query(QUESTION + """
				  JOIN app.mistakes m ON m.question_item_id = ci.id
				 WHERE m.child_id = ? AND m.resolved_at IS NULL AND ci.status = 'published'
				 ORDER BY m.last_wrong_at LIMIT ?""", KidPracticeService::question, childId, SET_SIZE);
		// A mixed set counts under its first question's subject
		int subjectId = questions.isEmpty() ? 0
				: jdbc.queryForObject("SELECT subject_id FROM app.content_items WHERE id = ?", Integer.class,
						questions.get(0).id());
		return new Set("mistakes", subjectId, null, questions);
	}

	private List<Topic> topics(UUID childId, int classLevel, int subjectId) {
		return jdbc.query("""
				SELECT t.id, t.name, (SELECT count(*) FROM app.content_items ci WHERE ci.topic_id = t.id AND\s""" + CHILD_QUESTIONS + """
				) AS questions
				  FROM app.topics t
				 WHERE t.class_level = ? AND t.subject_id = ? AND t.parent_id IS NULL AND t.archived_at IS NULL
				 ORDER BY t.sort_order, t.name""",
				(rs, n) -> new Topic(rs.getObject("id", UUID.class), rs.getString("name"), rs.getInt("questions")),
				classLevel, childId, classLevel, subjectId);
	}

	private static KidLessonService.Question question(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
		return new KidLessonService.Question(rs.getObject("id", UUID.class),
				rs.getObject("published_version_id", UUID.class), rs.getString("question_type"),
				rs.getObject("topic_id", UUID.class), JSON.readTree(rs.getString("body")),
				rs.getString("solution") == null ? null : JSON.readTree(rs.getString("solution")));
	}

	private int classOf(UUID childId) {
		List<Integer> classes = jdbc.queryForList("SELECT class_level FROM app.children WHERE id = ?", Integer.class,
				childId);
		if (classes.isEmpty()) {
			throw new NotFoundException();
		}
		return classes.get(0);
	}

}
