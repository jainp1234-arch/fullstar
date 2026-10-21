package com.fullstar.api.family.parent;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Settings rows of Schema §11 (auth P). PATCH is partial: absent = unchanged, null = invalid. */
@RestController
@RequestMapping("/api/v1/family/parent/settings")
public class SettingsController {

	private static final String DAILY_LIMIT = "daily_limit_minutes";

	private static final String SOUND = "sound_enabled";

	private static final String CELEBRATIONS = "celebrations_enabled";

	private static final Set<String> KNOWN = Set.of(DAILY_LIMIT, SOUND, CELEBRATIONS);

	private final SettingsService service;

	public SettingsController(SettingsService service) {
		this.service = service;
	}

	@GetMapping
	ApiResponse<SettingsService.Settings> get(HttpServletRequest request) {
		return ApiResponse.success(service.get(RequestActor.of(request)));
	}

	@PatchMapping
	ApiResponse<SettingsService.Settings> update(HttpServletRequest request,
			@RequestBody(required = false) JsonNode body) {
		return ApiResponse.success(service.update(RequestActor.of(request), parse(body)));
	}

	private static SettingsService.Change parse(JsonNode body) {
		if (body == null || body.isMissingNode()) {
			return new SettingsService.Change(null, null, null);
		}
		if (!body.isObject()) {
			throw new ValidationException("Request body is not valid", Map.of());
		}
		Map<String, String> errors = new LinkedHashMap<>();
		body.propertyNames().forEach(name -> {
			if (!KNOWN.contains(name)) {
				errors.put(name, "INVALID");
			}
		});
		Integer minutes = null;
		JsonNode limit = body.get(DAILY_LIMIT);
		if (limit != null) {
			if (limit.isInt()) {
				minutes = limit.intValue();
			}
			else {
				errors.put(DAILY_LIMIT, limit.isNull() ? "REQUIRED" : "INVALID");
			}
		}
		Boolean sound = flag(body, SOUND, errors);
		Boolean celebrations = flag(body, CELEBRATIONS, errors);
		if (!errors.isEmpty()) {
			throw new ValidationException("Settings are not valid", errors);
		}
		return new SettingsService.Change(minutes, sound, celebrations);
	}

	private static Boolean flag(JsonNode body, String name, Map<String, String> errors) {
		JsonNode node = body.get(name);
		if (node == null) {
			return null;
		}
		if (node.isBoolean()) {
			return node.booleanValue();
		}
		errors.put(name, node.isNull() ? "REQUIRED" : "INVALID");
		return null;
	}

}
