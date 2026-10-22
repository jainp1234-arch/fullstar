package com.fullstar.api.family.books;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.ratelimit.RateLimitKind;
import com.fullstar.api.common.ratelimit.RateLimited;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Books, chapters and uploads (Schema §11, auth P; App Flow P4–P7, B3; Plan 5.1). */
@RestController
@RequestMapping("/api/v1/family/parent")
public class BookController {

	private static final Set<String> CHAPTER_FIELDS = Set.of("title", "number");

	private final BookService books;

	private final UploadService uploads;

	public BookController(BookService books, UploadService uploads) {
		this.books = books;
		this.uploads = uploads;
	}

	record NewBookRequest(@NotBlank String childId, @NotNull @Min(1) @Max(10) Integer subjectId,
			@NotBlank @Pattern(regexp = "whole|chapterwise") String uploadMode) {
	}

	record ShareRequest(@NotBlank String childId) {
	}

	record FileRequest(@NotBlank @Size(max = 200) String name, @NotBlank String type, @NotNull @Min(1) Long size) {
	}

	record ChapterRequest(@NotNull @Min(1) @Max(99) Integer number,
			@NotBlank @Size(max = BookService.TITLE_MAX) String title) {
	}

	record NewUploadRequest(@NotBlank @Pattern(regexp = "pdf|photos") String source, String familyChapterId,
			@Valid ChapterRequest chapter, @NotEmpty @Size(max = 60) List<@Valid FileRequest> files) {
	}

	record SplitChapterRequest(@NotNull @Min(1) @Max(99) Integer number,
			@NotBlank @Size(max = BookService.TITLE_MAX) String title, @NotNull @Min(1) @Max(300) Integer startPage) {
	}

	record SplitRequest(@NotEmpty @Size(max = 99) List<@Valid SplitChapterRequest> chapters) {
	}

	@GetMapping("/books")
	ApiResponse<List<BookService.SubjectRow>> list(@RequestParam(name = "child_id") String childId) {
		return ApiResponse.success(books.list(field(childId, "child_id")));
	}

	@PostMapping("/books")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<BookService.Book> create(HttpServletRequest request, @Valid @RequestBody NewBookRequest body) {
		return ApiResponse.success(books.create(RequestActor.of(request), field(body.childId(), "child_id"),
				body.subjectId(), body.uploadMode()));
	}

	@PostMapping("/books/{id}/share")
	ApiResponse<BookService.Book> share(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody ShareRequest body) {
		return ApiResponse.success(books.share(RequestActor.of(request), path(id), field(body.childId(), "child_id")));
	}

	record ChapterOrderRequest(@NotEmpty @Size(max = 99) List<@NotBlank String> chapterIds) {
	}

	/** P9: removes the book, its chapters and the children's progress on them (Plan 7.4). */
	@PostMapping("/books/{id}/replace")
	ApiResponse<BookService.Replaced> replace(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(books.replace(RequestActor.of(request), path(id)));
	}

	/** P4: every chapter of a chapter-by-chapter book in the new order (Plan 7.4). */
	@PutMapping("/books/{id}/chapter-order")
	ApiResponse<List<BookService.Chapter>> reorder(@PathVariable String id,
			@Valid @RequestBody ChapterOrderRequest body) {
		return ApiResponse.success(books.reorderChapters(path(id),
				body.chapterIds().stream().map(c -> field(c, "chapter_ids")).toList()));
	}

	@GetMapping("/books/{id}/chapters")
	ApiResponse<List<BookService.Chapter>> chapters(@PathVariable String id) {
		return ApiResponse.success(books.chapters(path(id)));
	}

	/** Confirm the split of a whole book (P6). */
	@PutMapping("/books/{id}/chapters")
	ApiResponse<List<BookService.Chapter>> confirmSplit(@PathVariable String id, @Valid @RequestBody SplitRequest body) {
		return ApiResponse.success(books.confirmSplit(path(id), body.chapters()
			.stream()
			.map(c -> new BookService.SplitChapter(c.number(), c.title().strip(), c.startPage()))
			.toList()));
	}

	/** Pages of a chapter, optionally only unclear ones (P8). */
	@GetMapping("/chapters/{id}/pages")
	ApiResponse<List<BookService.Page>> pages(@PathVariable String id,
			@RequestParam(name = "quality", required = false) String quality) {
		if (quality != null && !Set.of("ok", "unclear", "retaken").contains(quality)) {
			throw new ValidationException("quality is not valid", Map.of("quality", "INVALID"));
		}
		return ApiResponse.success(books.pages(path(id), quality));
	}

	/** A new photo for one page (P8): answers the one-photo upload with its signed PUT URL. */
	@RateLimited(RateLimitKind.UPLOAD)
	@PostMapping("/pages/{id}/retake")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<UploadService.Upload> retake(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody FileRequest body) {
		return ApiResponse.success(uploads.retake(RequestActor.of(request), path(id),
				new UploadService.FileSpec(body.name().strip(), body.type(), body.size())));
	}

	@RateLimited(RateLimitKind.UPLOAD)
	@PostMapping("/books/{id}/uploads")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<UploadService.Upload> upload(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody NewUploadRequest body) {
		List<UploadService.FileSpec> files = body.files()
			.stream()
			.map(f -> new UploadService.FileSpec(f.name().strip(), f.type(), f.size()))
			.toList();
		UploadService.NewChapter chapter = body.chapter() == null ? null
				: new UploadService.NewChapter(body.chapter().number(), body.chapter().title().strip());
		return ApiResponse.success(uploads.create(RequestActor.of(request), path(id), body.source(),
				body.familyChapterId() == null ? null : field(body.familyChapterId(), "family_chapter_id"), chapter,
				files));
	}

	@PostMapping("/uploads/{id}/complete")
	ApiResponse<UploadService.Upload> complete(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(uploads.complete(RequestActor.of(request), path(id)));
	}

	/** Partial: title, number. */
	@PatchMapping("/chapters/{id}")
	ApiResponse<BookService.Chapter> updateChapter(@PathVariable String id,
			@RequestBody(required = false) JsonNode body) {
		Map<String, String> errors = new LinkedHashMap<>();
		String title = null;
		Integer number = null;
		if (body == null || !body.isObject()) {
			throw new ValidationException("Request body is not valid", Map.of());
		}
		body.propertyNames().forEach(name -> {
			if (!CHAPTER_FIELDS.contains(name)) {
				errors.put(name, "INVALID");
			}
		});
		JsonNode titleNode = body.get("title");
		if (titleNode != null) {
			if (!titleNode.isString() || titleNode.stringValue().isBlank()) {
				errors.put("title", "REQUIRED");
			}
			else if (titleNode.stringValue().strip().length() > BookService.TITLE_MAX) {
				errors.put("title", "INVALID_LENGTH");
			}
			else {
				title = titleNode.stringValue().strip();
			}
		}
		JsonNode numberNode = body.get("number");
		if (numberNode != null) {
			if (!numberNode.isInt()) {
				errors.put("number", "INVALID");
			}
			else if (numberNode.intValue() < 1 || numberNode.intValue() > 99) {
				errors.put("number", "OUT_OF_RANGE");
			}
			else {
				number = numberNode.intValue();
			}
		}
		if (!errors.isEmpty()) {
			throw new ValidationException("Chapter change is not valid", errors);
		}
		return ApiResponse.success(books.updateChapter(path(id), title, number));
	}

	@DeleteMapping("/chapters/{id}")
	ApiResponse<Map<String, UUID>> deleteChapter(@PathVariable String id) {
		UUID chapterId = path(id);
		books.deleteChapter(chapterId);
		return ApiResponse.success(Map.of("id", chapterId));
	}

	private static UUID path(String id) {
		try {
			return UUID.fromString(id);
		}
		catch (IllegalArgumentException ex) {
			throw new NotFoundException();
		}
	}

	private static UUID field(String value, String name) {
		try {
			return UUID.fromString(value);
		}
		catch (IllegalArgumentException | NullPointerException ex) {
			throw new ValidationException(name + " is not valid", Map.of(name, "INVALID"));
		}
	}

}
