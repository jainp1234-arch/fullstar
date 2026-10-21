package com.fullstar.api.family.books;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.storage.FileStorage;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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

	private static final String CHAPTER_COLUMNS = """
			c.id, c.number, c.title, c.status, c.page_count,
			(SELECT count(*) FROM app.pages p WHERE p.family_chapter_id = c.id AND p.quality = 'unclear') AS unclear_pages""";

	private final JdbcTemplate jdbc;

	private final FileStorage storage;

	public BookService(JdbcTemplate jdbc, FileStorage storage) {
		this.jdbc = jdbc;
		this.storage = storage;
	}

	/** unclearPages: pages to retake in P8 (Plan 5.3). */
	public record Chapter(UUID id, int number, String title, String status, int pageCount, int unclearPages) {
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
		return chaptersOf(bookId);
	}

	private List<Chapter> chaptersOf(UUID bookId) {
		return jdbc.query("SELECT " + CHAPTER_COLUMNS + " FROM app.family_chapters c WHERE family_book_id = ? ORDER BY number",
				BookService::chapter, bookId);
	}

	/** One chapter of a confirmed split (P6); startPage counts over the whole book (1-based). */
	public record SplitChapter(int number, String title, int startPage) {
	}

	/**
	 * Confirms the split of a whole book (P6, Plan 5.3): the full ordered list of chapters with their
	 * first page. Pages are moved, extra chapters made and empty ones removed; each chapter is then
	 * processing, or needs_attention while it has unclear pages. Only before read-along is ready.
	 */
	public List<Chapter> confirmSplit(UUID bookId, List<SplitChapter> split) {
		Book book = book(bookId);
		if (!"whole".equals(book.uploadMode()) || book.chapters().isEmpty()) {
			throw new ApiException(ErrorCode.CONFLICT, "Only an uploaded whole book can be split");
		}
		if (book.chapters().stream()
			.anyMatch(c -> !List.of("suggested", "processing", "needs_attention").contains(c.status()))) {
			throw new ApiException(ErrorCode.CONFLICT, "The chapters are already being prepared");
		}
		List<UUID> pages = jdbc.queryForList("""
				SELECT p.id FROM app.pages p JOIN app.family_chapters c ON c.id = p.family_chapter_id
				 WHERE c.family_book_id = ? ORDER BY c.number, p.page_no""", UUID.class, bookId);
		Map<String, String> errors = new LinkedHashMap<>();
		Set<Integer> numbers = new HashSet<>();
		for (int i = 0; i < split.size(); i++) {
			SplitChapter chapter = split.get(i);
			int previous = i == 0 ? 0 : split.get(i - 1).startPage();
			if (i == 0 ? chapter.startPage() != 1 : chapter.startPage() <= previous || chapter.startPage() > pages.size()) {
				errors.put("chapters[" + i + "].start_page", "INVALID");
			}
			if (!numbers.add(chapter.number())) {
				errors.put("chapters[" + i + "].number", "INVALID");
			}
		}
		if (!errors.isEmpty()) {
			throw new ValidationException("The chapter split is not valid", errors);
		}
		// Park the pages out of the way (page numbers are unique per chapter), then place them
		jdbc.update("""
				UPDATE app.pages SET page_no = page_no + 10000
				 WHERE family_chapter_id IN (SELECT id FROM app.family_chapters WHERE family_book_id = ?)""", bookId);
		List<UUID> rows = new ArrayList<>(book.chapters().stream().map(Chapter::id).toList());
		for (int i = 0; i < split.size(); i++) {
			SplitChapter chapter = split.get(i);
			UUID chapterId;
			if (i < rows.size()) {
				chapterId = rows.get(i);
				jdbc.update("UPDATE app.family_chapters SET number = ?, title = ? WHERE id = ?", chapter.number(),
						chapter.title(), chapterId);
			}
			else {
				chapterId = jdbc.queryForObject("""
						INSERT INTO app.family_chapters (family_book_id, family_id, number, title, status)
						SELECT id, family_id, ?, ?, 'processing' FROM app.family_books WHERE id = ? RETURNING id""",
						UUID.class, chapter.number(), chapter.title(), bookId);
			}
			int from = chapter.startPage() - 1;
			int to = i + 1 < split.size() ? split.get(i + 1).startPage() - 1 : pages.size();
			for (int p = from; p < to; p++) {
				jdbc.update("UPDATE app.pages SET family_chapter_id = ?, page_no = ? WHERE id = ?", chapterId, p - from + 1,
						pages.get(p));
			}
			jdbc.update("""
					UPDATE app.family_chapters c SET page_count = ?,
					       status = CASE WHEN EXISTS (SELECT 1 FROM app.pages p WHERE p.family_chapter_id = c.id
					                                   AND p.quality = 'unclear') THEN 'needs_attention' ELSE 'processing' END
					 WHERE id = ?""", to - from, chapterId);
		}
		for (UUID extra : rows.subList(Math.min(split.size(), rows.size()), rows.size())) {
			jdbc.update("DELETE FROM app.family_chapters WHERE id = ?", extra);
		}
		jdbc.update("UPDATE app.family_books SET split_confirmed_at = now() WHERE id = ?", bookId);
		log.info("Split confirmed bookId={} chapters={}", bookId, split.size());
		return chaptersOf(bookId);
	}

	/** A page for P8, with a short-lived signed link to its image. */
	public record Page(UUID id, int pageNo, String quality, double confidence, String imageUrl) {
	}

	public List<Page> pages(UUID chapterId, String quality) {
		Integer known = jdbc.queryForObject("SELECT count(*) FROM app.family_chapters WHERE id = ?", Integer.class,
				chapterId);
		if (known == null || known == 0) {
			throw new NotFoundException();
		}
		return jdbc.query("""
				SELECT id, page_no, quality, ocr_confidence, image_key FROM app.pages
				 WHERE family_chapter_id = ? AND (CAST(? AS text) IS NULL OR quality = ?) ORDER BY page_no""",
				(rs, n) -> new Page(rs.getObject("id", UUID.class), rs.getInt("page_no"), rs.getString("quality"),
						rs.getDouble("ocr_confidence"), storage.signedGet(rs.getString("image_key")).url().toString()),
				chapterId, quality, quality);
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
				"SELECT " + CHAPTER_COLUMNS + " FROM app.family_chapters c WHERE id = ?",
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
		List<Chapter> chapters = chaptersOf(bookId);
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
				rs.getString("status"), rs.getInt("page_count"), rs.getInt("unclear_pages"));
	}

}
