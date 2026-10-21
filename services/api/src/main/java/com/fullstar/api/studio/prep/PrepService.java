package com.fullstar.api.studio.prep;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.storage.FileStorage;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The Studio preparation queue (App Flow S8, S9; Schema §4.3 prep_tasks, §11; Plan 5.5). A prep task is
 * opened when a family chapter is ready to read along. A content admin claims it, reads the pages,
 * links the family chapter to a catalog chapter and prepares that chapter's content (S4–S6). A
 * catalog chapter that is already ready gives the family its lessons at once. Staff never see who the
 * family is: only a short reference, the class and the subject.
 */
@Service
public class PrepService {

	private static final Logger log = LoggerFactory.getLogger(PrepService.class);

	static final Set<String> STATUSES = Set.of("open", "in_progress", "done", "cancelled");

	private static final String TASK = """
			SELECT t.id, t.status, t.opened_at, t.started_at, t.completed_at, t.assigned_to, t.catalog_chapter_id,
			       fc.id AS family_chapter_id, fc.number, fc.title, fc.page_count, fc.status AS chapter_status,
			       fc.family_id, fb.id AS family_book_id, fb.class_level, fb.upload_mode, s.code AS subject,
			       s.name AS subject_name
			  FROM app.prep_tasks t
			  JOIN app.family_chapters fc ON fc.id = t.family_chapter_id
			  JOIN app.family_books fb ON fb.id = fc.family_book_id
			  JOIN app.subjects s ON s.id = fb.subject_id""";

	private final JdbcTemplate jdbc;

	private final FileStorage storage;

	private final AuditLog audit;

	public PrepService(JdbcTemplate jdbc, FileStorage storage, AuditLog audit) {
		this.jdbc = jdbc;
		this.storage = storage;
		this.audit = audit;
	}

	/** familyRef: the first 8 characters of the family id, enough to tell two uploads apart. */
	public record Task(UUID id, String status, Instant openedAt, Instant startedAt, Instant completedAt,
			boolean mine, boolean assigned, UUID familyChapterId, UUID familyBookId, String familyRef,
			int classLevel, String subject, String subjectName, String uploadMode, int chapterNumber,
			String chapterTitle, int pageCount, String chapterStatus, UUID catalogChapterId) {
	}

	public record CatalogLink(UUID catalogBookId, String bookTitle, UUID catalogChapterId, int number, String title,
			String status, int publishedLessons, int publishedQuestions, int unpublished) {
	}

	public record TaskDetail(Task task, CatalogLink catalog) {
	}

	public record Page(UUID id, int pageNo, String quality, String text, String imageUrl) {
	}

	public List<Task> list(UUID staffId, List<String> statuses) {
		return jdbc.query(TASK + " WHERE t.status = ANY (?) ORDER BY t.opened_at, t.id",
				(rs, n) -> task(rs, staffId), (Object) statuses.toArray(String[]::new));
	}

	public TaskDetail detail(UUID staffId, UUID taskId) {
		Task task = task(staffId, taskId);
		return new TaskDetail(task, task.catalogChapterId() == null ? null : catalog(task.catalogChapterId()));
	}

	/** Assign to me (S8). Claiming my own task again changes nothing; another admin's → 409. */
	public Task claim(UUID staffId, UUID taskId) {
		int claimed = jdbc.update("""
				UPDATE app.prep_tasks SET status = 'in_progress', assigned_to = ?, started_at = now()
				 WHERE id = ? AND status = 'open'""", staffId, taskId);
		Task task = task(staffId, taskId);
		if (claimed == 0 && !("in_progress".equals(task.status()) && task.mine())) {
			throw new ApiException(ErrorCode.CONFLICT, "This chapter is already being prepared or done");
		}
		if (claimed == 1) {
			log.info("Prep task claimed taskId={}", taskId);
		}
		return task;
	}

	/** S9: page images (signed, 10 minutes) and text; every view is in the audit log (upload.view). */
	public List<Page> pages(UUID staffId, UUID familyChapterId) {
		Integer known = jdbc.queryForObject("SELECT count(*) FROM app.family_chapters WHERE id = ?", Integer.class,
				familyChapterId);
		if (known == null || known == 0) {
			throw new NotFoundException();
		}
		List<Page> pages = jdbc.query("""
				SELECT id, page_no, quality, COALESCE(ocr_text, '') AS text, image_key FROM app.pages
				 WHERE family_chapter_id = ? ORDER BY page_no""",
				(rs, n) -> new Page(rs.getObject("id", UUID.class), rs.getInt("page_no"), rs.getString("quality"),
						rs.getString("text"), storage.signedGet(rs.getString("image_key")).url().toString()),
				familyChapterId);
		audit.staff(staffId, "upload.view", "family_chapter", familyChapterId, Map.of("pages", pages.size()));
		return pages;
	}

	/**
	 * Links the task's family chapter to a catalog chapter of the same class and subject. A ready
	 * catalog chapter gives the family its lessons now (lessons_ready, message, task done); otherwise
	 * the family chapter is lessons_being_prepared and the catalog chapter in_progress.
	 */
	public TaskDetail link(UUID staffId, UUID taskId, UUID catalogChapterId) {
		Task task = task(staffId, taskId);
		if (!Set.of("open", "in_progress").contains(task.status())) {
			throw new ApiException(ErrorCode.CONFLICT, "This task is closed");
		}
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT cc.status, cb.id AS book_id, cb.class_level, s.code AS subject
				  FROM app.catalog_chapters cc
				  JOIN app.catalog_books cb ON cb.id = cc.catalog_book_id
				  JOIN app.subjects s ON s.id = cb.subject_id
				 WHERE cc.id = ?""", catalogChapterId);
		if (rows.isEmpty()) {
			throw new ValidationException("catalog_chapter_id is not valid", Map.of("catalog_chapter_id", "INVALID"));
		}
		Map<String, Object> catalog = rows.get(0);
		if (((Number) catalog.get("class_level")).intValue() != task.classLevel()
				|| !task.subject().equals(catalog.get("subject"))) {
			throw new ValidationException("The catalog chapter is for another class or subject",
					Map.of("catalog_chapter_id", "INVALID"));
		}
		boolean ready = "ready".equals(catalog.get("status"));
		jdbc.update("UPDATE app.family_chapters SET catalog_chapter_id = ? WHERE id = ?", catalogChapterId,
				task.familyChapterId());
		jdbc.update("UPDATE app.family_books SET catalog_book_id = ? WHERE id = ?", catalog.get("book_id"),
				task.familyBookId());
		jdbc.update("""
				UPDATE app.prep_tasks SET catalog_chapter_id = ?, assigned_to = COALESCE(assigned_to, ?),
				       started_at = COALESCE(started_at, now()), status = ?, completed_at = ?
				 WHERE id = ?""", catalogChapterId, staffId, ready ? "done" : "in_progress",
				ready ? java.sql.Timestamp.from(Instant.now()) : null, taskId);
		if (ready) {
			int moved = jdbc.update("""
					UPDATE app.family_chapters SET status = 'lessons_ready'
					 WHERE id = ? AND status IN ('readalong_ready', 'lessons_being_prepared')""", task.familyChapterId());
			if (moved == 1) {
				// The same message on_catalog_chapter_ready sends when a chapter becomes ready (Schema §7)
				jdbc.update("""
						INSERT INTO app.messages (family_id, kind, title, body, link)
						VALUES (?, 'lessons_ready', 'Lessons ready', ?, jsonb_build_object('screen', 'P8a',
						        'family_chapter_id', CAST(? AS text)))""", familyId(task.familyChapterId()),
						"Lessons for " + task.subjectName() + " Ch " + task.chapterNumber()
								+ " are ready. We recommend a quick preview.",
						task.familyChapterId().toString());
			}
		}
		else {
			jdbc.update("""
					UPDATE app.family_chapters SET status = 'lessons_being_prepared'
					 WHERE id = ? AND status = 'readalong_ready'""", task.familyChapterId());
			jdbc.update("UPDATE app.catalog_chapters SET status = 'in_progress' WHERE id = ? AND status = 'not_started'",
					catalogChapterId);
		}
		audit.staff(staffId, "prep.link", "prep_task", taskId,
				Map.of("catalog_chapter_id", catalogChapterId.toString(), "instant", ready));
		log.info("Prep task linked taskId={} catalogChapterId={} instant={}", taskId, catalogChapterId, ready);
		return detail(staffId, taskId);
	}

	CatalogLink catalog(UUID catalogChapterId) {
		return jdbc.queryForObject("""
				SELECT cb.id AS book_id, cb.title AS book_title, cc.id, cc.number, cc.title, cc.status,
				       count(*) FILTER (WHERE ci.kind = 'lesson' AND ci.status = 'published') AS lessons,
				       count(*) FILTER (WHERE ci.kind = 'question' AND ci.status = 'published') AS questions,
				       count(*) FILTER (WHERE ci.status IN ('draft', 'in_check')) AS unpublished
				  FROM app.catalog_chapters cc
				  JOIN app.catalog_books cb ON cb.id = cc.catalog_book_id
				  LEFT JOIN app.content_items ci ON ci.catalog_chapter_id = cc.id
				 WHERE cc.id = ?
				 GROUP BY cb.id, cb.title, cc.id, cc.number, cc.title, cc.status""",
				(rs, n) -> new CatalogLink(rs.getObject("book_id", UUID.class), rs.getString("book_title"),
						rs.getObject("id", UUID.class), rs.getInt("number"), rs.getString("title"), rs.getString("status"),
						rs.getInt("lessons"), rs.getInt("questions"), rs.getInt("unpublished")),
				catalogChapterId);
	}

	private UUID familyId(UUID familyChapterId) {
		return jdbc.queryForObject("SELECT family_id FROM app.family_chapters WHERE id = ?", UUID.class,
				familyChapterId);
	}

	private Task task(UUID staffId, UUID taskId) {
		List<Task> tasks = jdbc.query(TASK + " WHERE t.id = ?", (rs, n) -> task(rs, staffId), taskId);
		if (tasks.isEmpty()) {
			throw new NotFoundException();
		}
		return tasks.get(0);
	}

	private static Task task(ResultSet rs, UUID staffId) throws SQLException {
		UUID assignedTo = rs.getObject("assigned_to", UUID.class);
		return new Task(rs.getObject("id", UUID.class), rs.getString("status"), instant(rs, "opened_at"),
				instant(rs, "started_at"), instant(rs, "completed_at"), staffId != null && staffId.equals(assignedTo),
				assignedTo != null, rs.getObject("family_chapter_id", UUID.class),
				rs.getObject("family_book_id", UUID.class), rs.getString("family_id").substring(0, 8),
				rs.getInt("class_level"), rs.getString("subject"), rs.getString("subject_name"),
				rs.getString("upload_mode"), rs.getInt("number"), rs.getString("title"), rs.getInt("page_count"),
				rs.getString("chapter_status"), rs.getObject("catalog_chapter_id", UUID.class));
	}

	private static Instant instant(ResultSet rs, String column) throws SQLException {
		java.sql.Timestamp value = rs.getTimestamp(column);
		return value == null ? null : value.toInstant();
	}

}
