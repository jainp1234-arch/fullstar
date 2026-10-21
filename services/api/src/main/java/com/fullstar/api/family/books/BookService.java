package com.fullstar.api.family.books;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.storage.FileStorage;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * A child's school books (Schema §4.3, §11; App Flow P4, B3, P7; Plan 5.1). One book per subject per
 * child; a book can be shared with a sibling in the same class. RLS keeps every row to the family.
 */
@Service
public class BookService {

	private static final Logger log = LoggerFactory.getLogger(BookService.class);

	static final int TITLE_MAX = 200;

	private final JdbcTemplate jdbc;

	private final FileStorage storage;

	public BookService(JdbcTemplate jdbc, FileStorage storage) {
		this.jdbc = jdbc;
		this.storage = storage;
	}

	public record Chapter(UUID id, int number, String title, String status, int pageCount) {
	}

	public record LatestUpload(UUID id, String source, String status, String rejectReason, int fileCount) {
	}

	public record Book(UUID id, int subjectId, String uploadMode, String status, int classLevel,
			List<UUID> childIds, List<Chapter> chapters, LatestUpload latestUpload) {
	}

	/** One P4 row: a subject of the child's class and its book, if any. */
	public record SubjectRow(int subjectId, String subject, String subjectName, Book book) {
	}

	private record ChildInfo(int classLevel) {
	}

	public List<SubjectRow> list(UUID childId) {
		ChildInfo child = child(childId);
		return jdbc.query("""
				SELECT s.id, s.code, s.name, cb.family_book_id
				  FROM app.class_subjects cs
				  JOIN app.subjects s ON s.id = cs.subject_id AND s.active
				  LEFT JOIN app.child_books cb ON cb.child_id = ? AND cb.subject_id = s.id
				 WHERE cs.class_level = ? ORDER BY s.id""",
				(rs, n) -> new SubjectRow(rs.getInt("id"), rs.getString("code"), rs.getString("name"),
						rs.getObject("family_book_id", UUID.class) == null ? null
								: book(rs.getObject("family_book_id", UUID.class))),
				childId, child.classLevel());
	}

	public Book create(RequestActor actor, UUID childId, int subjectId, String uploadMode) {
		ChildInfo child = child(childId);
		Integer taught = jdbc.queryForObject("""
				SELECT count(*) FROM app.class_subjects cs JOIN app.subjects s ON s.id = cs.subject_id AND s.active
				 WHERE cs.class_level = ? AND cs.subject_id = ?""", Integer.class, child.classLevel(), subjectId);
		if (taught == null || taught == 0) {
			throw new ValidationException("subject_id is not valid", Map.of("subject_id", "INVALID"));
		}
		requireNoBook(childId, subjectId);
		UUID bookId = jdbc.queryForObject("""
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, ?, ?, ?) RETURNING id""", UUID.class, actor.familyId(), subjectId, child.classLevel(),
				uploadMode);
		jdbc.update("INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id) VALUES (?, ?, ?, ?)",
				childId, subjectId, bookId, actor.familyId());
		log.info("Book created familyId={} bookId={} subjectId={} mode={}", actor.familyId(), bookId, subjectId,
				uploadMode);
		return book(bookId);
	}

	/** Shares a book with a sibling; the V9 trigger refuses another class (409 BOOK_MISMATCH). */
	public Book share(RequestActor actor, UUID bookId, UUID childId) {
		Book book = book(bookId);
		child(childId);
		if (book.childIds().contains(childId)) {
			return book;
		}
		requireNoBook(childId, book.subjectId());
		jdbc.update("INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id) VALUES (?, ?, ?, ?)",
				childId, book.subjectId(), bookId, actor.familyId());
		log.info("Book shared familyId={} bookId={}", actor.familyId(), bookId);
		return book(bookId);
	}

	public List<Chapter> chapters(UUID bookId) {
		book(bookId);
		return jdbc.query("""
				SELECT id, number, title, status, page_count FROM app.family_chapters
				 WHERE family_book_id = ? ORDER BY number""", BookService::chapter, bookId);
	}

	/** Rename or renumber (P7). A number used by another chapter answers 409 CONFLICT. */
	public Chapter updateChapter(UUID chapterId, String title, Integer number) {
		int updated = jdbc.update("""
				UPDATE app.family_chapters SET title = COALESCE(?, title), number = COALESCE(?, number)
				 WHERE id = ?""", title, number, chapterId);
		if (updated == 0) {
			throw new NotFoundException();
		}
		return jdbc.queryForObject(
				"SELECT id, number, title, status, page_count FROM app.family_chapters WHERE id = ?",
				BookService::chapter, chapterId);
	}

	/** Deletes a chapter with its uploads and pages; their files are removed once the delete commits. */
	public void deleteChapter(UUID chapterId) {
		List<String> keys = jdbc.queryForList("""
				SELECT f.object_key FROM app.upload_files f JOIN app.uploads u ON u.id = f.upload_id
				 WHERE u.family_chapter_id = ?
				UNION ALL
				SELECT image_key FROM app.pages WHERE family_chapter_id = ?
				UNION ALL
				SELECT narration_audio_key FROM app.pages WHERE family_chapter_id = ? AND narration_audio_key IS NOT NULL""",
				String.class, chapterId, chapterId, chapterId);
		int deleted = jdbc.update("DELETE FROM app.family_chapters WHERE id = ?", chapterId);
		if (deleted == 0) {
			throw new NotFoundException();
		}
		deleteAfterCommit(keys);
		log.info("Chapter deleted chapterId={} files={}", chapterId, keys.size());
	}

	public Book book(UUID bookId) {
		List<Map<String, Object>> rows = jdbc.queryForList(
				"SELECT id, subject_id, upload_mode, status, class_level FROM app.family_books WHERE id = ?", bookId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		List<UUID> children = jdbc.queryForList(
				"SELECT child_id FROM app.child_books WHERE family_book_id = ? ORDER BY created_at", UUID.class, bookId);
		List<Chapter> chapters = jdbc.query("""
				SELECT id, number, title, status, page_count FROM app.family_chapters
				 WHERE family_book_id = ? ORDER BY number""", BookService::chapter, bookId);
		List<LatestUpload> uploads = jdbc.query("""
				SELECT id, source, status, reject_reason, file_count FROM app.uploads
				 WHERE family_book_id = ? ORDER BY created_at DESC LIMIT 1""",
				(rs, n) -> new LatestUpload(rs.getObject("id", UUID.class), rs.getString("source"),
						rs.getString("status"), rs.getString("reject_reason"), rs.getInt("file_count")),
				bookId);
		return new Book(bookId, ((Number) row.get("subject_id")).intValue(), (String) row.get("upload_mode"),
				(String) row.get("status"), ((Number) row.get("class_level")).intValue(), children, chapters,
				uploads.isEmpty() ? null : uploads.get(0));
	}

	void deleteAfterCommit(List<String> keys) {
		if (keys.isEmpty()) {
			return;
		}
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCommit() {
				try {
					storage.delete(keys);
				}
				catch (RuntimeException ex) {
					// The rows are gone; leftover files are removed with the family prefix later
					log.warn("Could not delete {} files after commit: {}", keys.size(), ex.getClass().getSimpleName());
				}
			}
		});
	}

	private void requireNoBook(UUID childId, int subjectId) {
		Integer existing = jdbc.queryForObject("SELECT count(*) FROM app.child_books WHERE child_id = ? AND subject_id = ?",
				Integer.class, childId, subjectId);
		if (existing != null && existing > 0) {
			throw new ApiException(ErrorCode.BOOK_EXISTS, "This subject already has a book");
		}
	}

	private ChildInfo child(UUID childId) {
		List<Integer> levels = jdbc.queryForList("SELECT class_level FROM app.children WHERE id = ?", Integer.class,
				childId);
		if (levels.isEmpty()) {
			throw new ValidationException("child_id is not valid", Map.of("child_id", "INVALID"));
		}
		return new ChildInfo(levels.get(0));
	}

	private static Chapter chapter(ResultSet rs, int n) throws SQLException {
		return new Chapter(rs.getObject("id", UUID.class), rs.getInt("number"), rs.getString("title"),
				rs.getString("status"), rs.getInt("page_count"));
	}

}
