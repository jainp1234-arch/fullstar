package com.fullstar.api.family.lessons;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** P8a lesson preview (Schema §11, auth P; Plan 5.5). */
@RestController
@RequestMapping("/api/v1/family/parent")
public class LessonPreviewController {

	private final LessonPreviewService previews;

	public LessonPreviewController(LessonPreviewService previews) {
		this.previews = previews;
	}

	record PreviewResult(@NotBlank @Pattern(regexp = "looks_good|reported") String result,
			@Pattern(regexp = "wrong_answer|spelling|not_suitable|audio_problem|other") String reason,
			@Size(max = 500) String note) {
	}

	/** The published lessons of an uploaded chapter, with what this family answered (P8a list). */
	@GetMapping("/chapters/{id}/lessons")
	ApiResponse<List<LessonPreviewService.LessonCard>> lessons(@PathVariable String id) {
		return ApiResponse.success(previews.chapterLessons(path(id)));
	}

	@GetMapping("/lessons/{id}/preview")
	ApiResponse<LessonPreviewService.Preview> preview(@PathVariable String id) {
		return ApiResponse.success(previews.preview(path(id)));
	}

	@PostMapping("/lessons/{id}/preview-result")
	ApiResponse<LessonPreviewService.Preview> result(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody PreviewResult body) {
		String note = body.note() == null || body.note().isBlank() ? null : body.note().strip();
		return ApiResponse.success(previews.record(RequestActor.of(request), path(id), body.result(),
				"reported".equals(body.result()) ? body.reason() : null, note));
	}

	private static UUID path(String id) {
		try {
			return UUID.fromString(id);
		}
		catch (IllegalArgumentException ex) {
			throw new NotFoundException();
		}
	}

}
