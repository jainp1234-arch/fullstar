package com.fullstar.api.family.kid;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.security.FamilyGuards;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** K4 lesson and the offline event sync (Schema §11, auth K; Plan 6.2). */
@RestController
@RequestMapping("/api/v1/family/kid")
public class KidPlayController {

	private final KidLessonService lessons;

	private final KidSyncService sync;

	public KidPlayController(KidLessonService lessons, KidSyncService sync) {
		this.lessons = lessons;
		this.sync = sync;
	}

	record AttemptEvent(@NotNull UUID id, @NotBlank @Size(max = 20) String kind,
			@NotNull @Min(1) @Max(10) Integer subjectId, UUID contentItemId, UUID contentVersionId,
			UUID familyChapterId, UUID topicId, @NotNull Instant startedAt, Instant completedAt,
			@Min(0) @Max(500) Integer correctCount, @Min(0) @Max(500) Integer totalCount,
			@Min(0) @Max(86_400) Integer durationSeconds, JsonNode resumeState) {
	}

	record AnswerEvent(@NotNull UUID id, @NotNull UUID attemptId, @NotNull UUID questionItemId,
			@NotNull UUID questionVersionId, @NotNull Boolean isCorrect, @NotNull JsonNode answer,
			@NotNull Instant answeredAt) {
	}

	/** Limits keep one request small; a device with more sends several batches. */
	record SyncRequest(@Size(max = 200) List<@Valid @NotNull AttemptEvent> attempts,
			@Size(max = 2_000) List<@Valid @NotNull AnswerEvent> answers,
			@Size(max = 1_440) List<@NotNull Instant> minutes) {
	}

	@GetMapping("/lessons/{id}")
	ApiResponse<KidLessonService.Lesson> lesson(HttpServletRequest request, @PathVariable String id) {
		UUID itemId;
		try {
			itemId = UUID.fromString(id);
		}
		catch (IllegalArgumentException ex) {
			throw new NotFoundException();
		}
		return ApiResponse.success(lessons.lesson(child(request), itemId));
	}

	/** Send with an Idempotency-Key per batch: a retried batch answers the same without counting twice. */
	@PostMapping("/sync")
	ApiResponse<KidSyncService.Result> sync(HttpServletRequest request, @Valid @RequestBody SyncRequest body) {
		List<KidSyncService.Attempt> attempts = body.attempts() == null ? List.of()
				: body.attempts()
					.stream()
					.map(a -> new KidSyncService.Attempt(a.id(), a.kind(), a.subjectId(), a.contentItemId(),
							a.contentVersionId(), a.familyChapterId(), a.topicId(), a.startedAt(), a.completedAt(),
							a.correctCount(), a.totalCount(), a.durationSeconds() == null ? 0 : a.durationSeconds(),
							a.resumeState()))
					.toList();
		List<KidSyncService.Answer> answers = body.answers() == null ? List.of()
				: body.answers()
					.stream()
					.map(a -> new KidSyncService.Answer(a.id(), a.attemptId(), a.questionItemId(), a.questionVersionId(),
							a.isCorrect(), a.answer(), a.answeredAt()))
					.toList();
		return ApiResponse.success(sync.sync(RequestActor.of(request), child(request), attempts, answers,
				body.minutes() == null ? List.of() : body.minutes()));
	}

	private static UUID child(HttpServletRequest request) {
		return (UUID) request.getAttribute(FamilyGuards.CHILD_ATTRIBUTE);
	}

}
