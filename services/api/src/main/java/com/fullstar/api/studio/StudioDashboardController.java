package com.fullstar.api.studio;

import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * GET /studio/dashboard (Schema §11, S2): uploads waiting to be prepared, drafts in progress (draft or
 * in check), published in the last 7 days, open problem reports and open support tickets.
 */
@RestController
@RequestMapping("/api/v1/studio")
public class StudioDashboardController {

	private final JdbcTemplate jdbc;

	public StudioDashboardController(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	record DashboardCounts(long uploadsWaiting, long drafts, long recentlyPublished, long openReports,
			long openTickets) {
	}

	@GetMapping("/dashboard")
	ApiResponse<DashboardCounts> dashboard(HttpServletRequest request) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(jdbc.queryForObject("""
				SELECT (SELECT count(*) FROM app.prep_tasks WHERE status = 'open') AS uploads_waiting,
				       (SELECT count(*) FROM app.content_items WHERE status IN ('draft', 'in_check')) AS drafts,
				       (SELECT count(*) FROM app.content_items
				         WHERE status = 'published' AND published_at > now() - interval '7 days') AS recently_published,
				       (SELECT count(*) FROM app.problem_reports WHERE status = 'open') AS open_reports,
				       (SELECT count(*) FROM app.support_tickets WHERE status = 'open') AS open_tickets""",
				(rs, n) -> new DashboardCounts(rs.getLong("uploads_waiting"), rs.getLong("drafts"),
						rs.getLong("recently_published"), rs.getLong("open_reports"), rs.getLong("open_tickets"))));
	}

}
