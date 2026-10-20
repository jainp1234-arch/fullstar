package com.fullstar.api.studio;

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

/** GET /studio/me (Schema §11, S2): the signed-in staff member. */
@RestController
@RequestMapping("/api/v1/studio")
public class StudioMeController {

	private final JdbcTemplate jdbc;

	public StudioMeController(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	record StaffProfile(UUID id, String displayName, String role) {
	}

	@GetMapping("/me")
	ApiResponse<StaffProfile> me(HttpServletRequest request) {
		UUID staffId = StaffGuard.staffId(request);
		List<StaffProfile> rows = jdbc.query("SELECT id, display_name, role FROM app.staff_users WHERE id = ?",
				(rs, n) -> new StaffProfile(rs.getObject("id", UUID.class), rs.getString("display_name"),
						rs.getString("role")),
				staffId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		return ApiResponse.success(rows.get(0));
	}

}
