package com.fullstar.api.studio.content;

import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Topic tree per class and subject (Schema §4.2 topics, §11 /studio/topics, S3). */
@Service
public class TopicService {

	private static final Logger log = LoggerFactory.getLogger(TopicService.class);

	private static final String SELECT = """
			SELECT t.id, t.class_level, s.code AS subject, t.parent_id, t.name, t.sort_order,
			       t.archived_at IS NOT NULL AS archived,
			       (SELECT count(*) FROM app.content_items ci
			         WHERE ci.topic_id = t.id AND ci.status <> 'archived') AS item_count
			  FROM app.topics t JOIN app.subjects s ON s.id = t.subject_id""";

	private final JdbcTemplate jdbc;

	public TopicService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Topic(UUID id, int classLevel, String subject, UUID parentId, String name, int sortOrder,
			boolean archived, long itemCount) {
	}

	/** Absent fields are null and stay unchanged. */
	public record Change(String name, Integer sortOrder, Boolean archived) {
	}

	public List<Topic> list(Integer classLevel, String subject) {
		StringBuilder sql = new StringBuilder(SELECT).append(" WHERE true");
		List<Object> params = new ArrayList<>();
		if (classLevel != null) {
			sql.append(" AND t.class_level = ?");
			params.add(classLevel);
		}
		if (subject != null) {
			sql.append(" AND s.code = ?");
			params.add(subject);
		}
		sql.append(" ORDER BY t.class_level, s.id, t.sort_order, t.name, t.id");
		return jdbc.query(sql.toString(), TopicService::topic, params.toArray());
	}

	public Topic get(UUID id) {
		List<Topic> rows = jdbc.query(SELECT + " WHERE t.id = ?", TopicService::topic, id);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		return rows.get(0);
	}

	public Topic create(UUID staffId, int classLevel, String subject, UUID parentId, String name, int sortOrder) {
		short subjectId = StudioIds.subject(jdbc, classLevel, subject, "subject");
		if (parentId != null) {
			Integer same = jdbc.queryForObject("""
					SELECT count(*) FROM app.topics
					 WHERE id = ? AND class_level = ? AND subject_id = ? AND archived_at IS NULL""", Integer.class,
					parentId, classLevel, subjectId);
			if (same == null || same == 0) {
				// The parent must be a live topic of the same class and subject
				throw new ValidationException("parent_id is not valid", Map.of("parent_id", "INVALID"));
			}
		}
		UUID id = jdbc.queryForObject("""
				INSERT INTO app.topics (class_level, subject_id, parent_id, name, sort_order, created_by)
				VALUES (?, ?, ?, ?, ?, ?) RETURNING id""", UUID.class, classLevel, subjectId, parentId, name,
				sortOrder, staffId);
		log.info("Topic created topicId={} classLevel={} subject={}", id, classLevel, subject);
		return get(id);
	}

	public Topic update(UUID id, Change change) {
		int updated = jdbc.update("""
				UPDATE app.topics
				   SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order),
				       archived_at = CASE WHEN CAST(? AS boolean) IS NULL THEN archived_at
				                          WHEN CAST(? AS boolean) THEN COALESCE(archived_at, now()) ELSE NULL END
				 WHERE id = ?""", change.name(), change.sortOrder(), change.archived(), change.archived(), id);
		if (updated == 0) {
			throw new NotFoundException();
		}
		log.info("Topic updated topicId={}", id);
		return get(id);
	}

	private static Topic topic(ResultSet rs, int n) throws SQLException {
		return new Topic(rs.getObject("id", UUID.class), rs.getInt("class_level"), rs.getString("subject"),
				rs.getObject("parent_id", UUID.class), rs.getString("name"), rs.getInt("sort_order"),
				rs.getBoolean("archived"), rs.getLong("item_count"));
	}

}
