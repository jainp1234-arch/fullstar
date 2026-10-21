package com.fullstar.api.studio;

import com.fullstar.api.common.claude.AiProperties;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** GET /studio/me (Schema §11, S2): the signed-in staff member and the Claude feature flags. */
@RestController
@RequestMapping("/api/v1/studio")
public class StudioMeController {

	private final JdbcTemplate jdbc;

	private final AiProperties ai;

	public StudioMeController(JdbcTemplate jdbc, AiProperties ai) {
		this.jdbc = jdbc;
		this.ai = ai;
	}

	/** Which Claude features are on (Tech Stack §8a); off means the trial paths (Paste draft, manual check). */
	record Features(boolean aiDrafts, boolean aiCheck) {
	}

	record StaffProfile(UUID id, String displayName, String role, Features features) {
	}

	@GetMapping("/me")
	ApiResponse<StaffProfile> me(HttpServletRequest request) {
		UUID staffId = StaffGuard.staffId(request);
		List<StaffProfile> rows = jdbc.query("SELECT id, display_name, role FROM app.staff_users WHERE id = ?",
				(rs, n) -> new StaffProfile(rs.getObject("id", UUID.class), rs.getString("display_name"),
						rs.getString("role"), new Features(ai.draftsEnabled(), ai.checkEnabled())),
				staffId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		return ApiResponse.success(rows.get(0));
	}

}
