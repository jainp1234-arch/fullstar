package com.fullstar.api.studio.content;

import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.pagination.CursorPage;
import com.fullstar.api.common.pagination.PageRequest;
import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * Content items and versions (Schema §11, CA; S3, S5). Bodies are checked against Schema §5 before
 * saving; errors come back as field paths, e.g. {@code body.scenes[2].text: REQUIRED}.
 */
@RestController
@RequestMapping("/api/v1/studio")
public class ContentController {

	/** Schema §4.2 content_versions.title varchar(200). */
	static final int TITLE_MAX = 200;

	private static final String KINDS = "lesson|question|passage";

	private static final String STATUSES = "draft|in_check|published|archived";

	private final ContentService service;

	public ContentController(ContentService service) {
		this.service = service;
	}

	record NewItemRequest(@NotBlank @Pattern(regexp = KINDS) String kind, @NotNull @Min(1) @Max(5) Integer classLevel,
			@NotBlank String subject, @NotBlank String topicId,
			@Pattern(regexp = "mcq|true_false|fill_blank|match") String questionType,
			@Min(1) @Max(3) Integer difficulty, @NotBlank @Pattern(regexp = "en|hi") String lang,
			@NotBlank @Size(max = TITLE_MAX) String title, @NotNull JsonNode body, JsonNode solution) {
	}

	record NewVersionRequest(@NotBlank String baseVersionId, @NotBlank @Size(max = TITLE_MAX) String title,
			@NotNull JsonNode body, JsonNode solution) {
	}

	@GetMapping("/content-items")
	ApiResponse<CursorPage<ContentService.Summary>> list(HttpServletRequest request,
			@RequestParam(required = false) String kind, @RequestParam(name = "topic_id", required = false) String topicId,
			@RequestParam(name = "catalog_chapter_id", required = false) String catalogChapterId,
			@RequestParam(required = false) String status, @RequestParam(required = false) String q,
			@RequestParam(name = "class", required = false) Integer classLevel,
			@RequestParam(required = false) String subject, @RequestParam(required = false) Integer limit,
			@RequestParam(required = false) String cursor) {
		StaffGuard.requireStaff(request);
		if (kind != null && !kind.matches(KINDS)) {
			throw new ValidationException("kind is not valid", Map.of("kind", "INVALID"));
		}
		if (status != null && !status.matches(STATUSES)) {
			throw new ValidationException("status is not valid", Map.of("status", "INVALID"));
		}
		if (classLevel != null && (classLevel < 1 || classLevel > 5)) {
			throw new ValidationException("class is out of range", Map.of("class", "OUT_OF_RANGE"));
		}
		ContentService.Filter filter = new ContentService.Filter(kind, StudioIds.field(topicId, "topic_id"),
				StudioIds.field(catalogChapterId, "catalog_chapter_id"), status, q, classLevel, subject);
		return ApiResponse.success(service.list(filter, PageRequest.of(limit, cursor)));
	}

	@GetMapping("/content-items/{id}")
	ApiResponse<ContentService.Detail> get(HttpServletRequest request, @PathVariable String id) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(service.get(StudioIds.path(id)));
	}

	/** Any saved version, read-only (read_only = it is not the current version). */
	@GetMapping("/content-versions/{id}")
	ApiResponse<ContentService.Version> version(HttpServletRequest request, @PathVariable String id) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(service.version(StudioIds.path(id)));
	}

	@PostMapping("/content-items")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<ContentService.Detail> create(HttpServletRequest request, @Valid @RequestBody NewItemRequest body) {
		StaffGuard.requireStaff(request);
		ContentService.NewItem item = new ContentService.NewItem(body.kind(), body.classLevel(), body.subject(),
				StudioIds.field(body.topicId(), "topic_id"), body.questionType(),
				body.difficulty() == null ? 2 : body.difficulty(), body.lang(), body.title().strip(), body.body(),
				body.solution());
		return ApiResponse.success(service.create(StaffGuard.staffId(request), item));
	}

	/** Edits never overwrite: each save is a new version on top of base_version_id. */
	@PostMapping("/content-items/{id}/versions")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<ContentService.Detail> addVersion(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody NewVersionRequest body) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(service.addVersion(StaffGuard.staffId(request), StudioIds.path(id),
				StudioIds.field(body.baseVersionId(), "base_version_id"), body.title().strip(), body.body(),
				body.solution()));
	}

}
