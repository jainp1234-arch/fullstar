package com.fullstar.api.family.worksheets;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.security.FamilyGuards;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Worksheets: P10–P13 (auth P) and K6 on screen (auth K) (Schema §11; Plan 7.2). */
@RestController
public class WorksheetController {

	private final WorksheetService worksheets;

	public WorksheetController(WorksheetService worksheets) {
		this.worksheets = worksheets;
	}

	/** Schema §4.5: 5 to 30 questions. */
	record NewWorksheetRequest(@NotNull UUID childId, @NotNull @Min(1) @Max(10) Integer subjectId,
			@NotNull @Pattern(regexp = "chapter|topic") String source, UUID familyChapterId, UUID topicId,
			@NotNull @Min(5) @Max(30) Integer questionCount) {
	}

	record WeakSpotsRequest(@NotNull @Size(max = 30) List<@NotNull UUID> topicIds) {
	}

	@GetMapping("/api/v1/family/parent/worksheets")
	ApiResponse<List<WorksheetService.Summary>> list(@RequestParam(name = "child_id", required = false) UUID childId) {
		return ApiResponse.success(worksheets.list(childId));
	}

	@PostMapping("/api/v1/family/parent/worksheets")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<WorksheetService.Detail> create(HttpServletRequest request,
			@Valid @RequestBody NewWorksheetRequest body) {
		boolean chapter = "chapter".equals(body.source());
		if (chapter ? body.familyChapterId() == null || body.topicId() != null
				: body.topicId() == null || body.familyChapterId() != null) {
			String field = chapter ? "family_chapter_id" : "topic_id";
			throw new ValidationException(field + " is required for this source", Map.of(field, "REQUIRED"));
		}
		return ApiResponse.success(worksheets.create(RequestActor.of(request),
				new WorksheetService.NewWorksheet(body.childId(), body.subjectId(), body.source(),
						body.familyChapterId(), body.topicId(), body.questionCount())));
	}

	@PostMapping("/api/v1/family/parent/worksheets/{id}/reshuffle")
	ApiResponse<WorksheetService.Detail> reshuffle(@PathVariable String id) {
		return ApiResponse.success(worksheets.reshuffle(uuid(id)));
	}

	/** 200 with a signed link when ready; 202 while it is being made (ask again). */
	@GetMapping("/api/v1/family/parent/worksheets/{id}/pdf")
	ResponseEntity<ApiResponse<WorksheetService.Pdf>> pdf(@PathVariable String id) {
		WorksheetService.Pdf pdf = worksheets.pdf(uuid(id));
		return ResponseEntity.status("ready".equals(pdf.status()) ? HttpStatus.OK : HttpStatus.ACCEPTED)
			.body(ApiResponse.success(pdf));
	}

	@GetMapping("/api/v1/family/parent/worksheets/{id}/solutions")
	ApiResponse<WorksheetService.Detail> solutions(@PathVariable String id) {
		return ApiResponse.success(worksheets.solutions(uuid(id)));
	}

	@PutMapping("/api/v1/family/parent/worksheets/{id}/weak-spots")
	ApiResponse<WorksheetService.Detail> weakSpots(@PathVariable String id, @Valid @RequestBody WeakSpotsRequest body) {
		return ApiResponse.success(worksheets.weakSpots(uuid(id), body.topicIds()));
	}

	/** K6: the questions for on-screen use (the child's own worksheet). */
	@PostMapping("/api/v1/family/kid/worksheets/{id}/onscreen")
	ApiResponse<WorksheetService.Detail> onScreen(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(
				worksheets.onScreen((UUID) request.getAttribute(FamilyGuards.CHILD_ATTRIBUTE), uuid(id)));
	}

	private static UUID uuid(String id) {
		try {
			return UUID.fromString(id);
		}
		catch (IllegalArgumentException ex) {
			throw new NotFoundException();
		}
	}

}
