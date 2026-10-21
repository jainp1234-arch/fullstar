package com.fullstar.api.studio.ai;

import com.fullstar.api.common.error.ValidationException;
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
import java.util.UUID;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * POST /studio/ai/drafts (Schema §11, CA, S4) and POST /studio/ai/draft-prompt (Plan 4.3): the same
 * prompt the API sends to Claude, for pasting into a Claude chat while AI drafts are off.
 */
@RestController
@RequestMapping("/api/v1/studio/ai")
public class DraftController {

	/** A pasted draft: generous for 30 questions, small enough to parse safely. */
	static final int PASTE_MAX = 100_000;

	private final DraftService service;

	public DraftController(DraftService service) {
		this.service = service;
	}

	record DraftRequest(@NotBlank @Pattern(regexp = "lesson|question_bank|passage") String type,
			@NotNull @Min(1) @Max(5) Integer classLevel, @NotBlank String subject, String topicId,
			String familyChapterId, @Min(1) @Max(DraftService.MAX_QUESTIONS) Integer count,
			@Pattern(regexp = "en|hi") String lang, @Size(max = PASTE_MAX) String pasted) {
	}

	@PostMapping("/drafts")
	ApiResponse<DraftService.Draft> draft(HttpServletRequest request, @Valid @RequestBody DraftRequest body) {
		StaffGuard.requireStaff(request);
		DraftService.Request draft = toRequest(body, StaffGuard.staffId(request));
		return ApiResponse.success(body.pasted() == null || body.pasted().isBlank() ? service.fromClaude(draft)
				: service.fromPaste(draft, body.pasted()));
	}

	@PostMapping("/draft-prompt")
	ApiResponse<DraftPrompts.Prompt> prompt(HttpServletRequest request, @Valid @RequestBody DraftRequest body) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(service.prompt(toRequest(body, StaffGuard.staffId(request))));
	}

	private static DraftService.Request toRequest(DraftRequest body, UUID staffId) {
		UUID familyChapterId = null;
		if (body.familyChapterId() != null) {
			try {
				familyChapterId = UUID.fromString(body.familyChapterId());
			}
			catch (IllegalArgumentException ex) {
				throw new ValidationException("family_chapter_id is not valid", Map.of("family_chapter_id", "INVALID"));
			}
		}
		if (body.topicId() == null || body.topicId().isBlank()) {
			throw new ValidationException("topic_id is required", Map.of("topic_id", "REQUIRED"));
		}
		UUID topicId;
		try {
			topicId = UUID.fromString(body.topicId());
		}
		catch (IllegalArgumentException ex) {
			throw new ValidationException("topic_id is not valid", Map.of("topic_id", "INVALID"));
		}
		String lang = body.lang() != null ? body.lang() : "hindi".equals(body.subject()) ? "hi" : "en";
		return new DraftService.Request(body.type(), body.classLevel(), body.subject(), topicId,
				body.count() == null ? 10 : body.count(), lang, familyChapterId, staffId);
	}

}
