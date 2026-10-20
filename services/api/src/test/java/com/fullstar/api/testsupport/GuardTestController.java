package com.fullstar.api.testsupport;

import com.fullstar.api.common.security.FamilyGuards;
import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Test-only endpoints behind the real guards (kid mode, parent mode, super admin). */
@RestController
class GuardTestController {

	@GetMapping("/api/v1/family/kid/test-ping")
	ApiResponse<String> kid(HttpServletRequest request) {
		return ApiResponse.success(String.valueOf(request.getAttribute(FamilyGuards.CHILD_ATTRIBUTE)));
	}

	@GetMapping("/api/v1/family/parent/test-ping")
	ApiResponse<String> parent() {
		return ApiResponse.success("parent mode");
	}

	@GetMapping("/api/v1/studio/test-super-admin")
	ApiResponse<String> superAdmin(HttpServletRequest request) {
		StaffGuard.requireSuperAdmin(request);
		return ApiResponse.success("super admin");
	}

}
