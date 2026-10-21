package com.fullstar.api.studio.content;

import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.pagination.Cursor;
import com.fullstar.api.common.pagination.CursorPage;
import com.fullstar.api.common.pagination.PageRequest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Content items and their versions (Schema §4.2, §11, S3/S5). Saving always inserts a new version
 * (versions are immutable, trigger versions_no_update); the item points at its current version.
 * Library content, or content of a prepared catalog chapter (S9, Plan 5.5).
 */
@Service
public class ContentService {

	private static final Logger log = LoggerFactory.getLogger(ContentService.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final String SUMMARY = """
			SELECT ci.id, ci.kind, ci.question_type, ci.class_level, s.code AS subject, ci.topic_id, ci.difficulty,
			       ci.lang, ci.status, ci.current_version_id, ci.published_version_id, ci.updated_at,
			       cv.title, cv.version_no, ci.catalog_chapter_id
			  FROM app.content_items ci
			  JOIN app.subjects s ON s.id = ci.subject_id
			  LEFT JOIN app.content_versions cv ON cv.id = ci.current_version_id""";

	private static final String VERSION = """
			SELECT v.id, v.item_id, v.version_no, v.title, v.body::text AS body, v.solution::text AS solution,
			       v.duration_seconds, v.created_at, su.display_name AS created_by_name,
			       ci.current_version_id = v.id AS is_current, ci.published_version_id = v.id AS is_published
			  FROM app.content_versions v
			  JOIN app.content_items ci ON ci.id = v.item_id
			  LEFT JOIN app.staff_users su ON su.id = v.created_by""";

	private final JdbcTemplate jdbc;

	private final ContentFormats formats;

	public ContentService(JdbcTemplate jdbc, ContentFormats formats) {
		this.jdbc = jdbc;
		this.formats = formats;
	}

	public record Summary(UUID id, String kind, String questionType, int classLevel, String subject, UUID topicId,
			int difficulty, String lang, String status, UUID currentVersionId, UUID publishedVersionId, String title,
			int versionNo, Instant updatedAt, UUID catalogChapterId) {
	}

	/** A saved version; only the current one can be the base of the next save. */
	public record Version(UUID id, UUID itemId, int versionNo, String title, JsonNode body, JsonNode solution,
			Integer durationSeconds, Instant createdAt, String createdByName, boolean current, boolean published,
			boolean readOnly) {
	}

	public record VersionInfo(UUID id, int versionNo, String title, Instant createdAt, String createdByName,
			boolean current, boolean published) {
	}

	/** The current version's latest content check (S11), or null before the first one. */
	public record CheckSummary(UUID id, String status, String model, int criticalCount, int warningCount,
			int openFlags, boolean publishable) {
	}

	public record Detail(Summary item, Version currentVersion, List<VersionInfo> versions, CheckSummary latestCheck) {
	}

	public record Filter(String kind, UUID topicId, UUID catalogChapterId, String status, String q, Integer classLevel,
			String subject) {
	}

	/** catalogChapterId set: content of a prepared chapter (scope catalog_chapter, S9); otherwise library. */
	public record NewItem(String kind, int classLevel, String subject, UUID topicId, String questionType,
			int difficulty, String lang, String title, JsonNode body, JsonNode solution, UUID catalogChapterId) {

		public NewItem(String kind, int classLevel, String subject, UUID topicId, String questionType, int difficulty,
				String lang, String title, JsonNode body, JsonNode solution) {
			this(kind, classLevel, subject, topicId, questionType, difficulty, lang, title, body, solution, null);
		}

	}

	public CursorPage<Summary> list(Filter filter, PageRequest page) {
		StringBuilder sql = new StringBuilder(SUMMARY).append(" WHERE true");
		List<Object> params = new ArrayList<>();
		if (filter.kind() != null) {
			sql.append(" AND ci.kind = ?");
			params.add(filter.kind());
		}
		if (filter.topicId() != null) {
			sql.append(" AND ci.topic_id = ?");
			params.add(filter.topicId());
		}
		if (filter.catalogChapterId() != null) {
			sql.append(" AND ci.catalog_chapter_id = ?");
			params.add(filter.catalogChapterId());
		}
		if (filter.status() != null) {
			sql.append(" AND ci.status = ?");
			params.add(filter.status());
		}
		else {
			sql.append(" AND ci.status <> 'archived'");
		}
		if (filter.classLevel() != null) {
			sql.append(" AND ci.class_level = ?");
			params.add(filter.classLevel());
		}
		if (filter.subject() != null) {
			sql.append(" AND s.code = ?");
			params.add(filter.subject());
		}
		if (filter.q() != null && !filter.q().isBlank()) {
			sql.append(" AND cv.title ILIKE ? ESCAPE '\\'");
			params.add("%" + filter.q().strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
		}
		if (page.cursor() != null) {
			sql.append(" AND (ci.updated_at, ci.id) < (CAST(? AS timestamptz), ?)");
			params.add(page.cursor().sortKey());
			params.add(page.cursor().id());
		}
		sql.append(" ORDER BY ci.updated_at DESC, ci.id DESC LIMIT ?");
		params.add(page.fetchSize());
		List<Summary> rows = jdbc.query(sql.toString(), ContentService::summary, params.toArray());
		return CursorPage.of(rows, page, row -> new Cursor(row.updatedAt().toString(), row.id()));
	}

	public Detail get(UUID id) {
		Summary item = summary(id);
		Version current = item.currentVersionId() == null ? null : version(item.currentVersionId());
		List<VersionInfo> versions = jdbc.query("""
				SELECT v.id, v.version_no, v.title, v.created_at, su.display_name,
				       ci.current_version_id = v.id AS is_current, ci.published_version_id = v.id AS is_published
				  FROM app.content_versions v
				  JOIN app.content_items ci ON ci.id = v.item_id
				  LEFT JOIN app.staff_users su ON su.id = v.created_by
				 WHERE v.item_id = ? ORDER BY v.version_no DESC""",
				(rs, n) -> new VersionInfo(rs.getObject("id", UUID.class), rs.getInt("version_no"), rs.getString("title"),
						rs.getTimestamp("created_at").toInstant(), rs.getString("display_name"),
						rs.getBoolean("is_current"), rs.getBoolean("is_published")),
				id);
		CheckSummary check = item.currentVersionId() == null ? null : latestCheck(item.currentVersionId());
		return new Detail(item, current, versions, check);
	}

	private CheckSummary latestCheck(UUID versionId) {
		List<CheckSummary> rows = jdbc.query("""
				SELECT c.id, c.status, c.model, c.critical_count, c.warning_count,
				       (SELECT count(*) FROM app.content_check_flags f WHERE f.check_id = c.id AND f.resolution = 'open')
				         AS open_flags,
				       app.version_check_passed(c.version_id) AS publishable
				  FROM app.content_checks c WHERE c.version_id = ? ORDER BY c.started_at DESC, c.id LIMIT 1""",
				(rs, n) -> new CheckSummary(rs.getObject("id", UUID.class), rs.getString("status"), rs.getString("model"),
						rs.getInt("critical_count"), rs.getInt("warning_count"), rs.getInt("open_flags"),
						rs.getBoolean("publishable")),
				versionId);
		return rows.isEmpty() ? null : rows.get(0);
	}

	public Version version(UUID versionId) {
		List<Version> rows = jdbc.query(VERSION + " WHERE v.id = ?", ContentService::version, versionId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		return rows.get(0);
	}

	public Detail create(UUID staffId, NewItem item) {
		Map<String, String> errors = new LinkedHashMap<>();
		short subjectId = StudioIds.subject(jdbc, item.classLevel(), item.subject(), "subject");
		Integer topic = jdbc.queryForObject("""
				SELECT count(*) FROM app.topics
				 WHERE id = ? AND class_level = ? AND subject_id = ? AND archived_at IS NULL""", Integer.class,
				item.topicId(), item.classLevel(), subjectId);
		if (topic == null || topic == 0) {
			errors.put("topic_id", "INVALID");
		}
		if (item.catalogChapterId() != null) {
			Integer chapter = jdbc.queryForObject("""
					SELECT count(*) FROM app.catalog_chapters cc JOIN app.catalog_books cb ON cb.id = cc.catalog_book_id
					 WHERE cc.id = ? AND cb.class_level = ? AND cb.subject_id = ?""", Integer.class,
					item.catalogChapterId(), item.classLevel(), subjectId);
			if (chapter == null || chapter == 0) {
				errors.put("catalog_chapter_id", "INVALID");
			}
		}
		ContentFormats.Kind kind = ContentFormats.Kind.valueOf(item.kind().toUpperCase(Locale.ROOT));
		boolean question = kind == ContentFormats.Kind.QUESTION;
		if (question != (item.questionType() != null)) {
			errors.put("question_type", question ? "REQUIRED" : "INVALID");
		}
		if (errors.isEmpty()) {
			errors.putAll(check(kind, item.questionType(), item.body(), item.solution()));
		}
		if (!errors.isEmpty()) {
			throw new ValidationException("Content is not valid", errors);
		}
		UUID itemId = jdbc.queryForObject("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, difficulty,
				                               lang, created_by, catalog_chapter_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""", UUID.class, item.kind(),
				item.catalogChapterId() == null ? "library" : "catalog_chapter", item.classLevel(), subjectId,
				item.topicId(), item.questionType(), item.difficulty(), item.lang(), staffId, item.catalogChapterId());
		UUID versionId = insertVersion(staffId, itemId, kind, item.title(), item.body(), item.solution());
		jdbc.update("UPDATE app.content_items SET current_version_id = ? WHERE id = ?", versionId, itemId);
		log.info("Content item created itemId={} kind={}", itemId, item.kind());
		return get(itemId);
	}

	/** A new version on top of baseVersionId; a stale base means someone saved in between (409). */
	public Detail addVersion(UUID staffId, UUID itemId, UUID baseVersionId, String title, JsonNode body,
			JsonNode solution) {
		List<Map<String, Object>> rows = jdbc.queryForList(
				"SELECT kind, question_type, status, current_version_id FROM app.content_items WHERE id = ? FOR UPDATE",
				itemId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		if ("archived".equals(row.get("status"))) {
			throw new ApiException(ErrorCode.CONFLICT, "Archived content cannot be edited");
		}
		if (!baseVersionId.equals(row.get("current_version_id"))) {
			throw new ApiException(ErrorCode.CONFLICT, "A newer version was saved in the meantime");
		}
		ContentFormats.Kind kind = ContentFormats.Kind.valueOf(((String) row.get("kind")).toUpperCase(Locale.ROOT));
		Map<String, String> errors = check(kind, (String) row.get("question_type"), body, solution);
		if (!errors.isEmpty()) {
			throw new ValidationException("Content is not valid", errors);
		}
		UUID versionId = insertVersion(staffId, itemId, kind, title, body, solution);
		// A version waiting for a check goes back to draft: the new one has not been checked
		jdbc.update("""
				UPDATE app.content_items
				   SET current_version_id = ?, status = CASE WHEN status = 'in_check' THEN 'draft' ELSE status END
				 WHERE id = ?""", versionId, itemId);
		log.info("Content version saved itemId={} versionId={}", itemId, versionId);
		return get(itemId);
	}

	private Map<String, String> check(ContentFormats.Kind kind, String questionType, JsonNode body, JsonNode solution) {
		ContentFormats.Checked checked = formats.check(kind, questionType, body, solution);
		Map<String, String> errors = new LinkedHashMap<>(checked.errors());
		checked.quizQuestionPaths().forEach((path, id) -> {
			Integer published = jdbc.queryForObject("""
					SELECT count(*) FROM app.content_items
					 WHERE id = CAST(? AS uuid) AND kind = 'question' AND status = 'published'""", Integer.class, id);
			if (published == null || published == 0) {
				// Inline quizzes use a published question (Schema §5)
				errors.put(path, "INVALID");
			}
		});
		return errors;
	}

	private UUID insertVersion(UUID staffId, UUID itemId, ContentFormats.Kind kind, String title, JsonNode body,
			JsonNode solution) {
		boolean hasSolution = solution != null && !solution.isNull();
		Integer duration = kind == ContentFormats.Kind.LESSON ? ContentFormats.durationSeconds(body) : null;
		return jdbc.queryForObject("""
				INSERT INTO app.content_versions (item_id, title, body, solution, duration_seconds, created_by)
				VALUES (?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?) RETURNING id""", UUID.class, itemId, title,
				JSON.writeValueAsString(body), hasSolution ? JSON.writeValueAsString(solution) : null, duration, staffId);
	}

	private Summary summary(UUID id) {
		List<Summary> rows = jdbc.query(SUMMARY + " WHERE ci.id = ?", ContentService::summary, id);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		return rows.get(0);
	}

	private static Summary summary(ResultSet rs, int n) throws SQLException {
		Timestamp updated = rs.getTimestamp("updated_at");
		return new Summary(rs.getObject("id", UUID.class), rs.getString("kind"), rs.getString("question_type"),
				rs.getInt("class_level"), rs.getString("subject"), rs.getObject("topic_id", UUID.class),
				rs.getInt("difficulty"), rs.getString("lang"), rs.getString("status"),
				rs.getObject("current_version_id", UUID.class), rs.getObject("published_version_id", UUID.class),
				rs.getString("title"), rs.getInt("version_no"), updated.toInstant(),
				rs.getObject("catalog_chapter_id", UUID.class));
	}

	private static Version version(ResultSet rs, int n) throws SQLException {
		String solution = rs.getString("solution");
		Object duration = rs.getObject("duration_seconds");
		boolean current = rs.getBoolean("is_current");
		return new Version(rs.getObject("id", UUID.class), rs.getObject("item_id", UUID.class), rs.getInt("version_no"),
				rs.getString("title"), JSON.readTree(rs.getString("body")),
				solution == null ? null : JSON.readTree(solution), duration == null ? null : ((Number) duration).intValue(),
				rs.getTimestamp("created_at").toInstant(), rs.getString("created_by_name"), current,
				rs.getBoolean("is_published"), !current);
	}

}
