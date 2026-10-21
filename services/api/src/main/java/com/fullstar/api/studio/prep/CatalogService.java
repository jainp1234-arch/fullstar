package com.fullstar.api.studio.prep;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.studio.content.StudioIds;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Prepared books shared between families (Schema §4.2 catalog_books, catalog_chapters; S9; Plan 5.5).
 * A catalog chapter is marked ready once it has at least one published lesson and
 * {@value #MIN_QUESTIONS} published questions and nothing waiting in draft or the check (decided
 * 22 Oct 2026); trigger on_catalog_chapter_ready then gives every linked family its lessons.
 */
@Service
public class CatalogService {

	private static final Logger log = LoggerFactory.getLogger(CatalogService.class);

	/** App Flow S9: a question bank of 20+ questions. */
	public static final int MIN_QUESTIONS = 20;

	private static final int SEARCH_LIMIT = 20;

	private final JdbcTemplate jdbc;

	private final PrepService prep;

	private final AuditLog audit;

	public CatalogService(JdbcTemplate jdbc, PrepService prep, AuditLog audit) {
		this.jdbc = jdbc;
		this.prep = prep;
		this.audit = audit;
	}

	public record Chapter(UUID id, int number, String title, String status) {
	}

	public record Book(UUID id, int classLevel, String subject, String title, String board, String publisher,
			String edition, List<Chapter> chapters) {
	}

	public record NewBook(int classLevel, String subject, String title, String board, String publisher,
			String edition) {
	}

	/** Books of a class and subject whose title, publisher or edition contains q. */
	public List<Book> search(int classLevel, String subject, String q) {
		short subjectId = StudioIds.subject(jdbc, classLevel, subject, "subject");
		String like = q == null || q.isBlank() ? "%"
				: "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT id FROM app.catalog_books
				 WHERE class_level = ? AND subject_id = ?
				   AND (title ILIKE ? OR COALESCE(publisher, '') ILIKE ? OR COALESCE(edition, '') ILIKE ?)
				 ORDER BY title, id LIMIT ?""", classLevel, subjectId, like, like, like, SEARCH_LIMIT);
		List<Book> books = new ArrayList<>();
		for (Map<String, Object> row : rows) {
			books.add(book((UUID) row.get("id")));
		}
		return books;
	}

	public Book createBook(UUID staffId, NewBook book) {
		short subjectId = StudioIds.subject(jdbc, book.classLevel(), book.subject(), "subject");
		UUID id = jdbc.queryForObject("""
				INSERT INTO app.catalog_books (class_level, subject_id, title, board, publisher, edition, created_by)
				VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id""", UUID.class, book.classLevel(), subjectId, book.title(),
				book.board(), book.publisher(), book.edition(), staffId);
		audit.staff(staffId, "catalog_book.create", "catalog_book", id, Map.of());
		log.info("Catalog book created catalogBookId={}", id);
		return book(id);
	}

	/** A used number answers 409 CONFLICT (unique per book). */
	public Book createChapter(UUID staffId, UUID bookId, int number, String title) {
		book(bookId);
		UUID id = jdbc.queryForObject("""
				INSERT INTO app.catalog_chapters (catalog_book_id, number, title) VALUES (?, ?, ?) RETURNING id""",
				UUID.class, bookId, number, title);
		audit.staff(staffId, "catalog_chapter.create", "catalog_chapter", id, Map.of());
		return book(bookId);
	}

	/** PATCH {status: ready}: 409 CONFLICT naming what is missing. */
	public PrepService.CatalogLink markReady(UUID staffId, UUID catalogChapterId) {
		Integer known = jdbc.queryForObject("SELECT count(*) FROM app.catalog_chapters WHERE id = ?", Integer.class,
				catalogChapterId);
		if (known == null || known == 0) {
			throw new NotFoundException();
		}
		PrepService.CatalogLink chapter = prep.catalog(catalogChapterId);
		if ("ready".equals(chapter.status())) {
			return chapter;
		}
		List<String> missing = new ArrayList<>();
		if (chapter.publishedLessons() < 1) {
			missing.add("a published lesson");
		}
		if (chapter.publishedQuestions() < MIN_QUESTIONS) {
			missing.add(MIN_QUESTIONS + " published questions (now " + chapter.publishedQuestions() + ")");
		}
		if (chapter.unpublished() > 0) {
			missing.add("no content left in draft or the check (now " + chapter.unpublished() + ")");
		}
		if (!missing.isEmpty()) {
			throw new ApiException(ErrorCode.CONFLICT, "Not ready yet: needs " + String.join(", ", missing));
		}
		jdbc.update("UPDATE app.catalog_chapters SET status = 'ready' WHERE id = ?", catalogChapterId);
		Map<String, Object> metadata = new LinkedHashMap<>();
		metadata.put("lessons", chapter.publishedLessons());
		metadata.put("questions", chapter.publishedQuestions());
		audit.staff(staffId, "catalog_chapter.ready", "catalog_chapter", catalogChapterId, metadata);
		log.info("Catalog chapter ready catalogChapterId={}", catalogChapterId);
		return prep.catalog(catalogChapterId);
	}

	private Book book(UUID id) {
		List<Book> books = jdbc.query("""
				SELECT b.id, b.class_level, s.code AS subject, b.title, b.board, b.publisher, b.edition
				  FROM app.catalog_books b JOIN app.subjects s ON s.id = b.subject_id WHERE b.id = ?""",
				(rs, n) -> new Book(rs.getObject("id", UUID.class), rs.getInt("class_level"), rs.getString("subject"),
						rs.getString("title"), rs.getString("board"), rs.getString("publisher"), rs.getString("edition"),
						jdbc.query("""
								SELECT id, number, title, status FROM app.catalog_chapters
								 WHERE catalog_book_id = ? ORDER BY number""",
								(c, m) -> new Chapter(c.getObject("id", UUID.class), c.getInt("number"),
										c.getString("title"), c.getString("status")),
								id)),
				id);
		if (books.isEmpty()) {
			throw new NotFoundException();
		}
		return books.get(0);
	}

}
