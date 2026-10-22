package com.fullstar.api.studio.support;

import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import com.fullstar.api.studio.content.StudioIds;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
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

/** S7 problem reports and S12 support inbox (Schema §11, CA; Plan 7.3). */
@RestController
@RequestMapping("/api/v1/studio")
public class StudioSupportController {

	private static final Set<String> REPORT_STATUSES = Set.of("open", "fixed", "dismissed");

	private static final Set<String> TICKET_STATUSES = Set.of("open", "answered", "closed");

	private final StudioSupportService support;

	public StudioSupportController(StudioSupportService support) {
		this.support = support;
	}

	record ReportChange(@NotBlank @Pattern(regexp = "fixed|dismissed") String status) {
	}

	record ReplyRequest(@NotBlank @Size(max = 2000) String body) {
	}

	@GetMapping("/problem-reports")
	ApiResponse<List<StudioSupportService.Report>> reports(HttpServletRequest request,
			@RequestParam(defaultValue = "open") String status) {
		StaffGuard.requireStaff(request);
		if (!REPORT_STATUSES.contains(status)) {
			throw new ValidationException("status is not valid", Map.of("status", "INVALID"));
		}
		return ApiResponse.success(support.reports(status));
	}

	@PatchMapping("/problem-reports/{id}")
	ApiResponse<StudioSupportService.Report> handle(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody ReportChange body) {
		return ApiResponse.success(support.handle(StaffGuard.staffId(request), StudioIds.path(id), body.status()));
	}

	/** status: one or more of open, answered, closed (comma-separated); default open and answered. */
	@GetMapping("/support-tickets")
	ApiResponse<List<StudioSupportService.TicketSummary>> tickets(HttpServletRequest request,
			@RequestParam(required = false) String status) {
		StaffGuard.requireStaff(request);
		List<String> statuses = status == null || status.isBlank() ? List.of("open", "answered")
				: Arrays.stream(status.split(",")).map(String::strip).toList();
		if (!TICKET_STATUSES.containsAll(statuses)) {
			throw new ValidationException("status is not valid", Map.of("status", "INVALID"));
		}
		return ApiResponse.success(support.tickets(statuses));
	}

	@GetMapping("/support-tickets/{id}")
	ApiResponse<StudioSupportService.Ticket> ticket(HttpServletRequest request, @PathVariable String id) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(support.ticket(StudioIds.path(id)));
	}

	@PostMapping("/support-tickets/{id}/messages")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<StudioSupportService.Ticket> reply(HttpServletRequest request, @PathVariable String id,
			@Valid @RequestBody ReplyRequest body) {
		return ApiResponse.success(support.reply(StaffGuard.staffId(request), StudioIds.path(id), body.body().strip()));
	}

}
