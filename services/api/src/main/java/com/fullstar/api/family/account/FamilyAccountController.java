package com.fullstar.api.family.account;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.security.ParentGrantService;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Family account rows of Schema §11 (auth T: parent token). */
@RestController
@RequestMapping("/api/v1/family")
public class FamilyAccountController {

	private final FamilyAccountService service;

	public FamilyAccountController(FamilyAccountService service) {
		this.service = service;
	}

	record CreateFamilyRequest(@NotBlank @Size(max = 40) String consentVersion) {
	}

	/** App Flow B1/P0: a 4-digit PIN. */
	record PinRequest(@NotNull @Pattern(regexp = "\\d{4}") String pin) {
	}

	record GrantResponse(String parentGrant, long expiresIn) {
	}

	@GetMapping("/me")
	ApiResponse<FamilyAccountService.Me> me(HttpServletRequest request) {
		return ApiResponse.success(service.me(RequestActor.of(request)));
	}

	@PostMapping("/me")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<FamilyAccountService.Me> create(HttpServletRequest request, @AuthenticationPrincipal Jwt jwt,
			@Valid @RequestBody CreateFamilyRequest body) {
		return ApiResponse.success(service.create(RequestActor.of(request), jwt.getSubject(), body.consentVersion()));
	}

	@PostMapping("/pin")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<Map<String, Boolean>> setPin(HttpServletRequest request, @Valid @RequestBody PinRequest body) {
		service.setFirstPin(RequestActor.of(request), body.pin());
		return ApiResponse.success(Map.of("pin_set", true));
	}

	@PostMapping("/pin/verify")
	ApiResponse<GrantResponse> verifyPin(HttpServletRequest request, @AuthenticationPrincipal Jwt jwt,
			@Valid @RequestBody PinRequest body) {
		ParentGrantService.Grant grant = service.verifyPin(RequestActor.of(request), jwt.getSubject(), body.pin());
		return ApiResponse.success(new GrantResponse(grant.token(), grant.expiresInSeconds()));
	}

	@PutMapping("/pin")
	ApiResponse<Map<String, Boolean>> resetPin(HttpServletRequest request, @AuthenticationPrincipal Jwt jwt,
			@Valid @RequestBody PinRequest body) {
		service.resetPin(RequestActor.of(request), jwt.getClaimAsInstant("auth_time"), body.pin());
		return ApiResponse.success(Map.of("pin_set", true));
	}

}
