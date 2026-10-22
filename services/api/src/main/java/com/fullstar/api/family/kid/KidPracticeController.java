package com.fullstar.api.family.kid;

import com.fullstar.api.common.security.FamilyGuards;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** K8 practice home, K9 practice sets, K11 mistakes (Schema §11, auth K; Plan 7.1). */
@RestController
@RequestMapping("/api/v1/family/kid")
public class KidPracticeController {

	private final KidPracticeService practice;

	public KidPracticeController(KidPracticeService practice) {
		this.practice = practice;
	}

	/** kind: practice (a shuffled set); tables are made on the device. */
	record SetRequest(@NotNull @Min(1) @Max(10) Integer subjectId, UUID topicId,
			@Pattern(regexp = "practice") String kind) {
	}

	@GetMapping("/practice")
	ApiResponse<KidPracticeService.Home> home(HttpServletRequest request) {
		return ApiResponse.success(practice.home(child(request)));
	}

	/** Not stored: a new shuffle every time, so it needs no Idempotency-Key. */
	@PostMapping("/practice-sets")
	ApiResponse<KidPracticeService.Set> set(HttpServletRequest request, @Valid @RequestBody SetRequest body) {
		return ApiResponse.success(practice.practiceSet(child(request), body.subjectId(), body.topicId()));
	}

	@GetMapping("/mistakes")
	ApiResponse<KidPracticeService.Set> mistakes(HttpServletRequest request) {
		return ApiResponse.success(practice.mistakes(child(request)));
	}

	private static UUID child(HttpServletRequest request) {
		return (UUID) request.getAttribute(FamilyGuards.CHILD_ATTRIBUTE);
	}

}
