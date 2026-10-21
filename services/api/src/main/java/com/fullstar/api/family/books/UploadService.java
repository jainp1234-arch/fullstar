package com.fullstar.api.family.books;

import com.fullstar.api.common.config.FullstarProperties;
import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.jobs.JobPublisher;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.storage.FileStorage;
import com.fullstar.api.common.storage.StorageKeys;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Book uploads (Schema §4.3, §8.4, §11; App Flow B3, P5, P7; Plan 5.1). The API hands out signed PUT
 * URLs bound to each file's type and size; on complete it checks every file is there, within the
 * limits and really of its type (by its first bytes), then queues the virus scan (upload-scan).
 */
@Service
public class UploadService {

	private static final Logger log = LoggerFactory.getLogger(UploadService.class);

	public static final String SCAN_JOB = "upload.scan";

	static final String PDF = "application/pdf";

	static final List<String> PHOTO_TYPES = List.of("image/jpeg", "image/png");

	private static final byte[] PDF_MAGIC = { '%', 'P', 'D', 'F', '-' };

	private static final byte[] JPEG_MAGIC = { (byte) 0xFF, (byte) 0xD8, (byte) 0xFF };

	private static final byte[] PNG_MAGIC = { (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A };

	private final JdbcTemplate jdbc;

	private final FileStorage storage;

	private final JobPublisher jobs;

	private final FullstarProperties.Uploads limits;

	private final BookService books;

	public UploadService(JdbcTemplate jdbc, FileStorage storage, JobPublisher jobs, FullstarProperties properties,
			BookService books) {
		this.jdbc = jdbc;
		this.storage = storage;
		this.jobs = jobs;
		this.limits = properties.uploads();
		this.books = books;
	}

	public record FileSpec(String name, String type, long size) {
	}

	/** A new chapter for a chapterwise book (P7, B3 "Add first chapter"). */
	public record NewChapter(int number, String title) {
	}

	public record SignedFile(UUID id, String name, String url, String method, Map<String, String> headers,
			Instant expiresAt) {
	}

	public record Upload(UUID id, UUID familyBookId, UUID familyChapterId, String source, String status,
			String rejectReason, int fileCount, List<SignedFile> files) {
	}

	public Upload create(RequestActor actor, UUID bookId, String source, UUID chapterId, NewChapter chapter,
			List<FileSpec> files) {
		BookService.Book book = books.book(bookId);
		checkLimits(source, files);
		UUID targetChapter = null;
		if ("whole".equals(book.uploadMode())) {
			if (chapterId != null || chapter != null) {
				throw new ValidationException("A whole book is uploaded without a chapter",
						Map.of(chapterId != null ? "family_chapter_id" : "chapter", "INVALID"));
			}
			boolean active = jdbc.queryForObject("""
					SELECT count(*) > 0 FROM app.uploads
					 WHERE family_book_id = ? AND status NOT IN ('rejected', 'failed')""", Boolean.class, bookId);
			if (active) {
				// A second whole book goes through Replace book (P9)
				throw new ApiException(ErrorCode.BOOK_EXISTS, "This book is already uploaded");
			}
		}
		else if ((chapterId == null) == (chapter == null)) {
			throw new ValidationException("Give either family_chapter_id or chapter",
					Map.of("chapter", chapterId == null ? "REQUIRED" : "INVALID"));
		}
		else if (chapterId != null) {
			if (book.chapters().stream().noneMatch(c -> c.id().equals(chapterId))) {
				throw new ValidationException("family_chapter_id is not valid", Map.of("family_chapter_id", "INVALID"));
			}
			// New files for an existing chapter: it is processed again
			jdbc.update("UPDATE app.family_chapters SET status = 'processing' WHERE id = ?", chapterId);
			targetChapter = chapterId;
		}
		else {
			if (book.chapters().stream().anyMatch(c -> c.number() == chapter.number())) {
				throw new ApiException(ErrorCode.CONFLICT, "This book already has a chapter with that number");
			}
			targetChapter = jdbc.queryForObject("""
					INSERT INTO app.family_chapters (family_book_id, family_id, number, title)
					VALUES (?, ?, ?, ?) RETURNING id""", UUID.class, bookId, actor.familyId(), chapter.number(),
					chapter.title());
		}
		UUID uploadId = jdbc.queryForObject("""
				INSERT INTO app.uploads (family_id, family_book_id, family_chapter_id, source, file_count)
				VALUES (?, ?, ?, ?, ?) RETURNING id""", UUID.class, actor.familyId(), bookId, targetChapter, source,
				files.size());
		List<SignedFile> signed = new ArrayList<>();
		for (FileSpec file : files) {
			UUID fileId = UUID.randomUUID();
			String key = StorageKeys.upload(actor.familyId(), uploadId, fileId);
			jdbc.update("""
					INSERT INTO app.upload_files (id, upload_id, family_id, object_key, content_type, byte_size)
					VALUES (?, ?, ?, ?, ?, ?)""", fileId, uploadId, actor.familyId(), key, file.type(), file.size());
			FileStorage.SignedUrl url = storage.signedPut(key, file.type(), file.size());
			signed.add(new SignedFile(fileId, file.name(), url.url().toString(), url.method(),
					Map.of("Content-Type", file.type()), url.expiresAt()));
		}
		log.info("Upload created familyId={} uploadId={} source={} files={}", actor.familyId(), uploadId, source,
				files.size());
		return new Upload(uploadId, bookId, targetChapter, source, "awaiting_files", null, files.size(), signed);
	}

	/**
	 * All files are uploaded: check them and queue the scan. Answers the upload, now scanning or rejected
	 * (wrong_type, too_large). Calling it again changes nothing.
	 */
	public Upload complete(RequestActor actor, UUID uploadId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT family_book_id, family_chapter_id, source, status, reject_reason, file_count
				  FROM app.uploads WHERE id = ? FOR UPDATE""", uploadId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> upload = rows.get(0);
		if (!"awaiting_files".equals(upload.get("status"))) {
			return view(uploadId, upload);
		}
		List<Map<String, Object>> files = jdbc.queryForList(
				"SELECT id, object_key, content_type, byte_size FROM app.upload_files WHERE upload_id = ? ORDER BY id",
				uploadId);
		Map<String, String> missing = new LinkedHashMap<>();
		String reason = null;
		for (int i = 0; i < files.size() && reason == null; i++) {
			Map<String, Object> file = files.get(i);
			String key = (String) file.get("object_key");
			String type = (String) file.get("content_type");
			long size = storage.size(key);
			if (size < 0) {
				// By file id (as in the create answer): files of one upload have no order of their own
				missing.put("files." + file.get("id"), "REQUIRED");
				continue;
			}
			if (size > limitFor(type) || size != ((Number) file.get("byte_size")).longValue()) {
				reason = "too_large";
			}
			else if (!matchesType(storage.firstBytes(key, PNG_MAGIC.length), type)) {
				reason = "wrong_type";
			}
		}
		if (reason == null && !missing.isEmpty()) {
			throw new ValidationException("Some files have not been uploaded yet", missing);
		}
		UUID chapterId = (UUID) upload.get("family_chapter_id");
		if (reason != null) {
			jdbc.update("UPDATE app.uploads SET status = 'rejected', reject_reason = ? WHERE id = ?", reason, uploadId);
			if (chapterId != null) {
				jdbc.update("UPDATE app.family_chapters SET status = 'needs_attention' WHERE id = ?", chapterId);
			}
			books.deleteAfterCommit(files.stream().map(f -> (String) f.get("object_key")).toList());
			log.info("Upload rejected familyId={} uploadId={} reason={}", actor.familyId(), uploadId, reason);
		}
		else {
			jdbc.update("UPDATE app.uploads SET status = 'scanning' WHERE id = ?", uploadId);
			jobs.publish(JobQueue.UPLOAD_SCAN, SCAN_JOB, SCAN_JOB + ":" + uploadId, Map.of("upload_id", uploadId,
					"object_keys", files.stream().map(f -> (String) f.get("object_key")).toList()));
			log.info("Upload complete familyId={} uploadId={} files={}", actor.familyId(), uploadId, files.size());
		}
		return view(uploadId, jdbc.queryForList("""
				SELECT family_book_id, family_chapter_id, source, status, reject_reason, file_count
				  FROM app.uploads WHERE id = ?""", uploadId).get(0));
	}

	/** Limits of Schema §4.3 and the PRD; anything over them answers 413 UPLOAD_LIMIT. */
	void checkLimits(String source, List<FileSpec> files) {
		boolean pdf = "pdf".equals(source);
		boolean ok = !files.isEmpty() && (pdf ? files.size() == 1 : files.size() <= limits.photosPerUpload());
		for (FileSpec file : files) {
			ok &= pdf ? PDF.equals(file.type()) : PHOTO_TYPES.contains(file.type());
			ok &= file.size() > 0 && file.size() <= limitFor(file.type());
		}
		if (!ok) {
			throw new ApiException(ErrorCode.UPLOAD_LIMIT, "Use one PDF up to 50 MB, or up to "
					+ limits.photosPerUpload() + " JPG/PNG photos up to 10 MB each");
		}
	}

	private long limitFor(String type) {
		return PDF.equals(type) ? limits.pdfMaxBytes() : limits.photoMaxBytes();
	}

	/** The file-type check by content: the first bytes must be those of the declared type. */
	static boolean matchesType(byte[] head, String type) {
		byte[] magic = switch (type) {
			case PDF -> PDF_MAGIC;
			case "image/jpeg" -> JPEG_MAGIC;
			case "image/png" -> PNG_MAGIC;
			default -> null;
		};
		return magic != null && head.length >= magic.length
				&& Arrays.equals(Arrays.copyOf(head, magic.length), magic);
	}

	private static Upload view(UUID uploadId, Map<String, Object> row) {
		return new Upload(uploadId, (UUID) row.get("family_book_id"), (UUID) row.get("family_chapter_id"),
				(String) row.get("source"), (String) row.get("status"), (String) row.get("reject_reason"),
				((Number) row.get("file_count")).intValue(), List.of());
	}

}
