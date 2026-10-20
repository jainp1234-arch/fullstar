package com.fullstar.api.publicapi;

import com.fullstar.api.common.web.ApiResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public endpoints (Schema §11): no sign-in needed. */
@RestController
@RequestMapping("/api/v1/public")
public class PublicController {

	private final PublicConfigService configService;

	private final HealthService healthService;

	public PublicController(PublicConfigService configService, HealthService healthService) {
		this.configService = configService;
		this.healthService = healthService;
	}

	@GetMapping("/health")
	ResponseEntity<ApiResponse<HealthService.Health>> health() {
		HealthService.Health health = healthService.current();
		HttpStatus status = health.readiness().equals(HealthService.UP) ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
		return ResponseEntity.status(status).body(ApiResponse.success(health));
	}

	@GetMapping("/config")
	ApiResponse<PublicConfigService.PublicConfig> config() {
		return ApiResponse.success(configService.current());
	}

}
