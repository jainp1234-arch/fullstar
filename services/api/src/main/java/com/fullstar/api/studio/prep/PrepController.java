package com.fullstar.api.studio.prep;

import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import com.fullstar.api.studio.content.StudioIds;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Preparation queue, catalog books and chapters (Schema §11, CA; App Flow S8, S9; Plan 5.5). */
@RestController
@RequestMapping("/api/v1/studio")
public class PrepController {

	private static final int TITLE_MAX = 200;

	private final PrepService prep;

	private final CatalogService catalog;

	public PrepController(PrepService prep, CatalogService catalog) {
		this.prep = prep;
		this.catalog = catalog;
	}

	record LinkRequest(@NotBlank String catalogChapterId) {
	}

	record NewBookRequest(@NotNull @Min(1) @Max(5) Integer classLevel, @NotBlank String subject,
			@NotBlank @Size(max = TITLE_MAX) String title, @Pattern(regexp = "CBSE|ICSE|STATE|OTHER") String board,
			@Size(max = 120) String publisher, @Size(max = 40) String edition) {
	}

	record NewChapterRequest(@NotNull @Min(1) @Max(99) Integer number, @NotBlank @Size(max = TITLE_MAX) String title) {
	}

	record ChapterChange(@NotBlank @Pattern(regexp = "ready") String status) {
	}

	/** status: one or more of open, in_progress, done, cancelled (comma-separated); default open. */
	@GetMapping("/prep-tasks")
	ApiResponse<List<PrepService.Task>> list(HttpServletRequest request,
			@RequestParam(required = false) String status) {
		List<String> statuses = status == null || status.isBlank() ? List.of("open")
				: Arrays.stream(status.split(",")).map(String::strip).toList();
		if (!PrepService.STATUSES.containsAll(statuses)) {
			throw new ValidationException("status is not valid", Map.of("status", "INVALID"));
		}
		return ApiResponse.success(prep.list(StaffGuard.staffId(request), statuses));
	}

	@GetMapping("/prep-tasks/{id}")
	ApiResponse<PrepService.TaskDetail> detail(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(prep.detail(StaffGuard.staffId(request), StudioIds.path(id)));
	}

	@PostMapping("/prep-tasks/{id}/claim")
	ApiResponse<PrepService.Task> claim(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(prep.claim(StaffGuard.staffId(request), StudioIds.path(id)));
	}

	@PostMapping("/prep-tasks/{id}/link")
	ApiResponse<PrepService.TaskDetail> link(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody LinkRequest body) {
		return ApiResponse.success(prep.link(StaffGuard.staffId(request), StudioIds.path(id),
				StudioIds.field(body.catalogChapterId(), "catalog_chapter_id")));
	}

	@GetMapping("/family-chapters/{id}/pages")
	ApiResponse<List<PrepService.Page>> pages(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(prep.pages(StaffGuard.staffId(request), StudioIds.path(id)));
	}

	@GetMapping("/catalog-books")
	ApiResponse<List<CatalogService.Book>> searchBooks(HttpServletRequest request,
			@RequestParam(name = "class") Integer classLevel, @RequestParam String subject,
			@RequestParam(required = false) String q) {
		StaffGuard.requireStaff(request);
		if (classLevel < 1 || classLevel > 5) {
			throw new ValidationException("class is not valid", Map.of("class", "OUT_OF_RANGE"));
		}
		return ApiResponse.success(catalog.search(classLevel, subject, q));
	}

	@PostMapping("/catalog-books")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<CatalogService.Book> createBook(HttpServletRequest request, @Valid @RequestBody NewBookRequest body) {
		return ApiResponse.success(catalog.createBook(StaffGuard.staffId(request),
				new CatalogService.NewBook(body.classLevel(), body.subject(), body.title().strip(),
						body.board() == null ? "CBSE" : body.board(), blankToNull(body.publisher()),
						blankToNull(body.edition()))));
	}

	@PostMapping("/catalog-books/{id}/chapters")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<CatalogService.Book> createChapter(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody NewChapterRequest body) {
		return ApiResponse.success(catalog.createChapter(StaffGuard.staffId(request), StudioIds.path(id),
				body.number(), body.title().strip()));
	}

	@PatchMapping("/catalog-chapters/{id}")
	ApiResponse<PrepService.CatalogLink> updateChapter(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody ChapterChange body) {
		return ApiResponse.success(catalog.markReady(StaffGuard.staffId(request), StudioIds.path(id)));
	}

	private static String blankToNull(String value) {
		return value == null || value.isBlank() ? null : value.strip();
	}

}
