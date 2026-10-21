package com.fullstar.api.studio.staff;

import com.fullstar.api.common.db.RequestActor.StaffRole;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Manage staff users and roles (Schema §11, SA; App Flow S13). */
@RestController
@RequestMapping("/api/v1/studio/staff")
public class StaffController {

	static final String ROLE_PATTERN = "content_admin|super_admin";

	private static final int NAME_MAX = 80;

	private static final String DISPLAY_NAME = "display_name";

	private static final String ROLE = "role";

	private static final String ACTIVE = "active";

	private static final Set<String> EDITABLE = Set.of(DISPLAY_NAME, ROLE, ACTIVE);

	private final StaffService service;

	public StaffController(StaffService service) {
		this.service = service;
	}

	record AddStaffRequest(@NotBlank @Email @Size(max = 254) String email,
			@NotBlank @Size(max = NAME_MAX) String displayName, @NotBlank @Pattern(regexp = ROLE_PATTERN) String role) {
	}

	@GetMapping
	ApiResponse<List<StaffService.Staff>> list(HttpServletRequest request) {
		StaffGuard.requireSuperAdmin(request);
		return ApiResponse.success(service.list());
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<StaffService.Staff> add(HttpServletRequest request, @Valid @RequestBody AddStaffRequest body) {
		StaffGuard.requireSuperAdmin(request);
		return ApiResponse.success(service.create(StaffGuard.staffId(request), body.email(), body.displayName().strip(),
				role(body.role())));
	}

	/** Partial: absent = unchanged, null = REQUIRED. The email (Keycloak account) never changes. */
	@PatchMapping("/{id}")
	ApiResponse<StaffService.Staff> update(HttpServletRequest request, @PathVariable String id,
			@RequestBody(required = false) JsonNode body) {
		StaffGuard.requireSuperAdmin(request);
		UUID staffId = parseId(id);
		return ApiResponse.success(service.update(StaffGuard.staffId(request), staffId, parse(body)));
	}

	private static StaffRole role(String value) {
		return StaffRole.valueOf(value.toUpperCase(Locale.ROOT));
	}

	private static UUID parseId(String id) {
		try {
			return UUID.fromString(id);
		}
		catch (IllegalArgumentException ex) {
			throw new NotFoundException();
		}
	}

	private static StaffService.Change parse(JsonNode body) {
		if (body == null || body.isMissingNode()) {
			return new StaffService.Change(null, null, null);
		}
		if (!body.isObject()) {
			throw new ValidationException("Request body is not valid", Map.of());
		}
		Map<String, String> errors = new LinkedHashMap<>();
		body.propertyNames().forEach(name -> {
			if (!EDITABLE.contains(name)) {
				errors.put(name, "INVALID");
			}
		});
		String displayName = null;
		JsonNode name = body.get(DISPLAY_NAME);
		if (name != null) {
			if (!name.isString() || name.stringValue().isBlank()) {
				errors.put(DISPLAY_NAME, name.isString() || name.isNull() ? "REQUIRED" : "INVALID");
			}
			else if (name.stringValue().strip().length() > NAME_MAX) {
				errors.put(DISPLAY_NAME, "INVALID_LENGTH");
			}
			else {
				displayName = name.stringValue().strip();
			}
		}
		StaffRole role = null;
		JsonNode roleNode = body.get(ROLE);
		if (roleNode != null) {
			if (roleNode.isString() && roleNode.stringValue().matches(ROLE_PATTERN)) {
				role = role(roleNode.stringValue());
			}
			else {
				errors.put(ROLE, roleNode.isNull() ? "REQUIRED" : "INVALID");
			}
		}
		Boolean active = null;
		JsonNode activeNode = body.get(ACTIVE);
		if (activeNode != null) {
			if (activeNode.isBoolean()) {
				active = activeNode.booleanValue();
			}
			else {
				errors.put(ACTIVE, activeNode.isNull() ? "REQUIRED" : "INVALID");
			}
		}
		if (!errors.isEmpty()) {
			throw new ValidationException("Staff change is not valid", errors);
		}
		return new StaffService.Change(displayName, role, active);
	}

}
