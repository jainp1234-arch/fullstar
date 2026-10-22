package com.fullstar.api.family.support;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** P18 problem reports and P16 Contact us tickets (Schema §11, auth P; Plan 7.3). */
@RestController
@RequestMapping("/api/v1/family/parent")
public class SupportController {

	private final SupportService support;

	public SupportController(SupportService support) {
		this.support = support;
	}

	/** Schema §4.6: reason codes and the 500-character note; ticket subject 120, message 2 000. */
	record ReportRequest(@NotNull UUID contentItemId,
			@NotBlank @Pattern(regexp = "wrong_answer|spelling|not_suitable|audio_problem|other") String reason,
			@Size(max = 500) String note) {
	}

	record TicketRequest(@NotBlank @Size(max = 120) String subject, @NotBlank @Size(max = 2000) String body) {
	}

	record ReplyRequest(@NotBlank @Size(max = 2000) String body) {
	}

	@PostMapping("/problem-reports")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<SupportService.Report> report(HttpServletRequest request, @Valid @RequestBody ReportRequest body) {
		String note = body.note() == null || body.note().isBlank() ? null : body.note().strip();
		return ApiResponse.success(support.report(RequestActor.of(request), body.contentItemId(), body.reason(), note));
	}

	@GetMapping("/support-tickets")
	ApiResponse<List<SupportService.Ticket>> tickets() {
		return ApiResponse.success(support.tickets());
	}

	@PostMapping("/support-tickets")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<SupportService.Ticket> open(HttpServletRequest request, @Valid @RequestBody TicketRequest body) {
		return ApiResponse.success(support.open(RequestActor.of(request), body.subject().strip(), body.body().strip()));
	}

	@PostMapping("/support-tickets/{id}/messages")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<SupportService.Ticket> reply(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody ReplyRequest body) {
		return ApiResponse.success(support.reply(RequestActor.of(request), uuid(id), body.body().strip()));
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
