package com.fullstar.api.family.worksheets;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.jobs.JobPublisher;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.storage.FileStorage;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Worksheets (App Flow P10–P13, K6; Schema §4.5, §11, §12 worksheet-render; Plan 7.2). Questions are
 * picked from the chapter's (prepared catalog chapter) or the topic's (with sub-topics) published
 * question bank in an order fixed by the worksheet's shuffle seed, and stored with their versions,
 * so a reprint shows the very same questions. The PDF is rendered by a job, kept 30 days, and
 * rendered again when asked for after that. Shuffle again works only before the first print
 * (printed_at, decided 22 Oct 2026). RLS keeps every row to the family.
 */
@Service
public class WorksheetService {

	private static final Logger log = LoggerFactory.getLogger(WorksheetService.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	public static final String RENDER_JOB = "worksheet.render";

	private static final SecureRandom SEEDS = new SecureRandom();

	private static final String READY = "('readalong_ready', 'lessons_being_prepared', 'lessons_ready')";

	private static final String SUMMARY = """
			SELECT w.id, w.child_id, w.subject_id, s.code AS subject, s.name AS subject_name, w.source,
			       w.family_chapter_id, w.topic_id, COALESCE(fc.title, t.name) AS source_title, fc.number AS chapter_number,
			       w.question_count, w.status, w.printed_at, w.pdf_expires_at, w.created_at
			  FROM app.worksheets w
			  JOIN app.subjects s ON s.id = w.subject_id
			  LEFT JOIN app.family_chapters fc ON fc.id = w.family_chapter_id
			  LEFT JOIN app.topics t ON t.id = w.topic_id""";

	private final JdbcTemplate jdbc;

	private final JobPublisher jobs;

	private final FileStorage storage;

	public WorksheetService(JdbcTemplate jdbc, JobPublisher jobs, FileStorage storage) {
		this.jdbc = jdbc;
		this.jobs = jobs;
		this.storage = storage;
	}

	public record Summary(UUID id, UUID childId, int subjectId, String subject, String subjectName, String source,
			UUID familyChapterId, UUID topicId, String sourceTitle, Integer chapterNumber, int questionCount,
			String status, Instant printedAt, Instant createdAt) {
	}

	public record Question(int position, UUID id, UUID versionId, String questionType, UUID topicId, String topicName,
			JsonNode body, JsonNode solution) {
	}

	/** questions: without solutions for the preview (P11), with them for solutions (P13) and K6. */
	public record Detail(Summary worksheet, List<Question> questions, List<UUID> weakSpots) {
	}

	/** ready: url is a signed link (10 minutes); rendering: ask again shortly (202). */
	public record Pdf(String status, String url, Instant expiresAt) {
	}

	public record NewWorksheet(UUID childId, int subjectId, String source, UUID familyChapterId, UUID topicId,
			int questionCount) {
	}

	public List<Summary> list(UUID childId) {
		return childId == null ? jdbc.query(SUMMARY + " ORDER BY w.created_at DESC LIMIT 100", WorksheetService::summary)
				: jdbc.query(SUMMARY + " WHERE w.child_id = ? ORDER BY w.created_at DESC LIMIT 100",
						WorksheetService::summary, childId);
	}

	public Detail create(RequestActor actor, NewWorksheet w) {
		List<Integer> classes = jdbc.queryForList("SELECT class_level FROM app.children WHERE id = ?", Integer.class,
				w.childId());
		if (classes.isEmpty()) {
			throw new ValidationException("child_id is not valid", Map.of("child_id", "INVALID"));
		}
		Pool pool = pool(w.childId(), classes.get(0), w.subjectId(), w.source(), w.familyChapterId(), w.topicId());
		if (pool.available() < w.questionCount()) {
			throw new ValidationException("Only " + pool.available() + " questions are ready for this",
					Map.of("question_count", "OUT_OF_RANGE"));
		}
		UUID id = jdbc.queryForObject("""
				INSERT INTO app.worksheets (family_id, child_id, subject_id, source, family_chapter_id, topic_id,
				                            question_count, shuffle_seed)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""", UUID.class, actor.familyId(), w.childId(),
				w.subjectId(), w.source(), w.familyChapterId(), w.topicId(), w.questionCount(), SEEDS.nextLong());
		pick(id);
		render(id);
		log.info("Worksheet created worksheetId={} questions={}", id, w.questionCount());
		return detail(id, false);
	}

	/** P11 Shuffle again: a new seed and new questions, only before the first print. */
	public Detail reshuffle(UUID id) {
		Summary w = summary(id);
		if (w.printedAt() != null) {
			throw new ApiException(ErrorCode.CONFLICT, "This worksheet was printed already; create a new one");
		}
		jdbc.update("UPDATE app.worksheets SET shuffle_seed = ?, status = 'rendering', pdf_key = NULL, pdf_expires_at = NULL WHERE id = ?",
				SEEDS.nextLong(), id);
		pick(id);
		render(id);
		return detail(id, false);
	}

	/** P12: the first ask is the first print. Expired or never made → rendering (202). */
	public Pdf pdf(UUID id) {
		Summary w = summary(id);
		jdbc.update("UPDATE app.worksheets SET printed_at = COALESCE(printed_at, now()) WHERE id = ?", id);
		Map<String, Object> row = jdbc.queryForMap("SELECT status, pdf_key, pdf_expires_at FROM app.worksheets WHERE id = ?",
				id);
		java.sql.Timestamp expires = (java.sql.Timestamp) row.get("pdf_expires_at");
		boolean fresh = "ready".equals(row.get("status")) && row.get("pdf_key") != null && expires != null
				&& expires.toInstant().isAfter(Instant.now());
		if (fresh) {
			FileStorage.SignedUrl url = storage.signedGet((String) row.get("pdf_key"));
			return new Pdf("ready", url.url().toString(), expires.toInstant());
		}
		if (!"rendering".equals(w.status())) {
			jdbc.update("UPDATE app.worksheets SET status = 'rendering' WHERE id = ?", id);
			render(id);
		}
		return new Pdf("rendering", null, null);
	}

	public Detail solutions(UUID id) {
		return detail(id, true);
	}

	/** P13: replaces the ticks; only topics of the worksheet's questions. */
	public Detail weakSpots(UUID id, List<UUID> topicIds) {
		Summary w = summary(id);
		Set<UUID> allowed = new java.util.HashSet<>(jdbc.queryForList("""
				SELECT DISTINCT ci.topic_id FROM app.worksheet_questions q JOIN app.content_items ci ON ci.id = q.question_item_id
				 WHERE q.worksheet_id = ? AND ci.topic_id IS NOT NULL""", UUID.class, id));
		if (!allowed.containsAll(topicIds)) {
			throw new ValidationException("topic_ids are not of this worksheet", Map.of("topic_ids", "INVALID"));
		}
		jdbc.update("DELETE FROM app.worksheet_weak_spots WHERE worksheet_id = ?", id);
		for (UUID topic : new java.util.LinkedHashSet<>(topicIds)) {
			jdbc.update("""
					INSERT INTO app.worksheet_weak_spots (worksheet_id, topic_id, family_id, child_id)
					SELECT id, ?, family_id, child_id FROM app.worksheets WHERE id = ?""", topic, id);
		}
		log.info("Weak spots ticked worksheetId={} topics={}", id, topicIds.size());
		return detail(w.id(), true);
	}

	/** K6: the questions on screen, for the worksheet's child only; starting it counts as the first print. */
	public Detail onScreen(UUID childId, UUID id) {
		Summary w = summary(id);
		if (!w.childId().equals(childId)) {
			throw new NotFoundException();
		}
		jdbc.update("UPDATE app.worksheets SET printed_at = COALESCE(printed_at, now()) WHERE id = ?", id);
		return detail(id, true);
	}

	private record Pool(String where, Object param, int available) {
	}

	/** The question bank a worksheet draws from; checks the source belongs to the child. */
	private Pool pool(UUID childId, int classLevel, int subjectId, String source, UUID chapterId, UUID topicId) {
		if ("chapter".equals(source)) {
			List<UUID> catalog = jdbc.queryForList("""
					SELECT fc.catalog_chapter_id FROM app.child_books cb
					  JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
					 WHERE cb.child_id = ? AND cb.subject_id = ? AND fc.id = ? AND fc.status IN %s
					   AND fc.catalog_chapter_id IS NOT NULL""".formatted(READY), UUID.class, childId, subjectId,
					chapterId);
			if (catalog.isEmpty()) {
				throw new ValidationException("family_chapter_id is not valid", Map.of("family_chapter_id", "INVALID"));
			}
			return counted("ci.catalog_chapter_id = ?", catalog.get(0));
		}
		Integer topic = jdbc.queryForObject("""
				SELECT count(*) FROM app.topics WHERE id = ? AND class_level = ? AND subject_id = ? AND archived_at IS NULL""",
				Integer.class, topicId, classLevel, subjectId);
		if (topic == null || topic == 0) {
			throw new ValidationException("topic_id is not valid", Map.of("topic_id", "INVALID"));
		}
		return counted("""
				ci.scope = 'library' AND ci.topic_id IN (WITH RECURSIVE tree AS (SELECT id FROM app.topics WHERE id = ?
				  UNION ALL SELECT t.id FROM app.topics t JOIN tree ON t.parent_id = tree.id) SELECT id FROM tree)""",
				topicId);
	}

	private Pool counted(String where, Object param) {
		Integer n = jdbc.queryForObject("""
				SELECT count(*) FROM app.content_items ci WHERE ci.kind = 'question' AND ci.status = 'published' AND\s"""
				+ where, Integer.class, param);
		return new Pool(where, param, n == null ? 0 : n);
	}

	/** Questions in the order the seed gives (md5 of seed and id), stored with their published version. */
	private void pick(UUID id) {
		Map<String, Object> w = jdbc.queryForMap("""
				SELECT child_id, subject_id, source, family_chapter_id, topic_id, question_count, shuffle_seed,
				       (SELECT class_level FROM app.children c WHERE c.id = child_id) AS class_level
				  FROM app.worksheets WHERE id = ?""", id);
		Pool pool = pool((UUID) w.get("child_id"), ((Number) w.get("class_level")).intValue(),
				((Number) w.get("subject_id")).intValue(), (String) w.get("source"), (UUID) w.get("family_chapter_id"),
				(UUID) w.get("topic_id"));
		jdbc.update("DELETE FROM app.worksheet_questions WHERE worksheet_id = ?", id);
		jdbc.update("""
				INSERT INTO app.worksheet_questions (worksheet_id, position, question_item_id, question_version_id)
				SELECT ?, row_number() OVER (ORDER BY md5(CAST(? AS text) || ci.id::text)), ci.id, ci.published_version_id
				  FROM (SELECT ci.id, ci.published_version_id FROM app.content_items ci
				         WHERE ci.kind = 'question' AND ci.status = 'published' AND\s""" + pool.where() + """

				         ORDER BY md5(CAST(? AS text) || ci.id::text) LIMIT ?) ci""",
				id, String.valueOf(w.get("shuffle_seed")), pool.param(), String.valueOf(w.get("shuffle_seed")),
				((Number) w.get("question_count")).intValue());
	}

	private void render(UUID id) {
		jobs.publish(JobQueue.WORKSHEET_RENDER, RENDER_JOB, RENDER_JOB + ":" + id + ":" + UUID.randomUUID(),
				Map.of("worksheet_id", id));
	}

	private Detail detail(UUID id, boolean withSolutions) {
		Summary w = summary(id);
		List<Question> questions = new ArrayList<>(jdbc.query("""
				SELECT q.position, q.question_item_id, q.question_version_id, ci.question_type, ci.topic_id, t.name AS topic_name,
				       cv.body::text AS body, cv.solution::text AS solution
				  FROM app.worksheet_questions q
				  JOIN app.content_items ci ON ci.id = q.question_item_id
				  JOIN app.content_versions cv ON cv.id = q.question_version_id
				  LEFT JOIN app.topics t ON t.id = ci.topic_id
				 WHERE q.worksheet_id = ? ORDER BY q.position""",
				(rs, n) -> new Question(rs.getInt("position"), rs.getObject("question_item_id", UUID.class),
						rs.getObject("question_version_id", UUID.class), rs.getString("question_type"),
						rs.getObject("topic_id", UUID.class), rs.getString("topic_name"),
						JSON.readTree(rs.getString("body")),
						withSolutions && rs.getString("solution") != null ? JSON.readTree(rs.getString("solution")) : null),
				id));
		List<UUID> weak = jdbc.queryForList("SELECT topic_id FROM app.worksheet_weak_spots WHERE worksheet_id = ?",
				UUID.class, id);
		return new Detail(w, questions, weak);
	}

	private Summary summary(UUID id) {
		List<Summary> rows = jdbc.query(SUMMARY + " WHERE w.id = ?", WorksheetService::summary, id);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		return rows.get(0);
	}

	private static Summary summary(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
		return new Summary(rs.getObject("id", UUID.class), rs.getObject("child_id", UUID.class), rs.getInt("subject_id"),
				rs.getString("subject"), rs.getString("subject_name"), rs.getString("source"),
				rs.getObject("family_chapter_id", UUID.class), rs.getObject("topic_id", UUID.class),
				rs.getString("source_title"), (Integer) rs.getObject("chapter_number"), rs.getInt("question_count"),
				rs.getString("status"),
				rs.getTimestamp("printed_at") == null ? null : rs.getTimestamp("printed_at").toInstant(),
				rs.getTimestamp("created_at").toInstant());
	}

}
