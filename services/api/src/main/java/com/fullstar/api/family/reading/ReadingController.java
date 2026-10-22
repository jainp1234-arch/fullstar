package com.fullstar.api.family.reading;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.security.FamilyGuards;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** K12–K14 reading (Schema §11, auth K) and P3 reading history (auth P); Plan 8.3. */
@RestController
@RequestMapping("/api/v1/family")
public class ReadingController {

	private final ReadingService reading;

	public ReadingController(ReadingService reading) {
		this.reading = reading;
	}

	/** content_type and size: the recording the device will PUT (MediaRecorder's codec). */
	record StartRequest(@NotBlank String id, @NotBlank String attemptId, @NotBlank String passageItemId,
			@NotBlank @Pattern(regexp = "audio/(webm|ogg|mp4)") String contentType,
			@NotNull @Min(1) @Max(ReadingService.MAX_RECORDING_BYTES) Long size) {
	}

	@GetMapping("/kid/reading")
	ApiResponse<ReadingService.Home> home(HttpServletRequest request) {
		return ApiResponse.success(reading.home(child(request)));
	}

	@PostMapping("/kid/reading-tests")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<ReadingService.Test> start(HttpServletRequest request, @Valid @RequestBody StartRequest body) {
		return ApiResponse.success(reading.start(RequestActor.of(request), child(request), field(body.id(), "id"),
				field(body.attemptId(), "attempt_id"), field(body.passageItemId(), "passage_item_id"),
				body.contentType(), body.size()));
	}

	@PostMapping("/kid/reading-tests/{id}/submit")
	ApiResponse<ReadingService.Test> submit(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(reading.submit(RequestActor.of(request), child(request), path(id)));
	}

	@GetMapping("/kid/reading-tests/{id}")
	ApiResponse<ReadingService.Test> test(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(reading.test(child(request), path(id)));
	}

	@GetMapping("/parent/children/{childId}/reading-tests")
	ApiResponse<List<ReadingService.HistoryEntry>> history(@PathVariable String childId) {
		return ApiResponse.success(reading.history(path(childId)));
	}

	private static UUID child(HttpServletRequest request) {
		return (UUID) request.getAttribute(FamilyGuards.CHILD_ATTRIBUTE);
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
		catch (IllegalArgumentException ex) {
			throw new ValidationException(name + " is not valid", Map.of(name, "INVALID"));
		}
	}

}
