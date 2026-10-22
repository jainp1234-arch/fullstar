package com.fullstar.api.family.parent;

import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.web.ApiResponse;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** P1 This week and P2 subject detail (Schema §11, auth P; Plan 6.4). */
@RestController
@RequestMapping("/api/v1/family/parent/children/{childId}")
public class ProgressController {

	private final ProgressService progress;

	public ProgressController(ProgressService progress) {
		this.progress = progress;
	}

	/** start: any day of the week wanted (YYYY-MM-DD); default this week. */
	@GetMapping("/week")
	ApiResponse<ProgressService.Week> week(@PathVariable String childId,
			@RequestParam(required = false) String start) {
		LocalDate day;
		try {
			day = start == null ? ProgressService.thisWeek() : LocalDate.parse(start);
		}
		catch (DateTimeParseException ex) {
			throw new ValidationException("start is not valid", Map.of("start", "INVALID_FORMAT"));
		}
		return ApiResponse.success(progress.week(uuid(childId), day));
	}

	@GetMapping("/subjects/{subjectId}")
	ApiResponse<ProgressService.SubjectDetail> subject(@PathVariable String childId,
			@PathVariable String subjectId) {
		int id;
		try {
			id = Integer.parseInt(subjectId);
		}
		catch (NumberFormatException ex) {
			throw new NotFoundException();
		}
		return ApiResponse.success(progress.subject(uuid(childId), id));
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
