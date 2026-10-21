package com.fullstar.api.studio.check;

import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import com.fullstar.api.studio.content.ContentService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

/** Content checks, flags and publishing (Schema §11, §12a, CA; S11, S6; Plan 4.4). */
@RestController
@RequestMapping("/api/v1/studio")
public class CheckController {

	private final ContentCheckService checks;

	private final PublishService publishing;

	private final ContentService content;

	public CheckController(ContentCheckService checks, PublishService publishing, ContentService content) {
		this.checks = checks;
		this.publishing = publishing;
		this.content = content;
	}

	/** Runs the content-check agent (FEATURE_AI_CHECK); 202 with the running check. */
	@PostMapping("/content-versions/{id}/checks")
	@ResponseStatus(HttpStatus.ACCEPTED)
	ApiResponse<ContentCheckService.Check> runCheck(HttpServletRequest request, @PathVariable String id) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(checks.requestAgentCheck(StaffGuard.staffId(request), uuid(id)));
	}

	/** Trial manual check (Schema §12a): { checklist: {7 items: true|false}, flags: [...] }. */
	@PostMapping("/content-versions/{id}/manual-check")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<ContentCheckService.Check> manualCheck(HttpServletRequest request, @PathVariable String id,
			@RequestBody(required = false) JsonNode body) {
		StaffGuard.requireStaff(request);
		Map<String, String> errors = new LinkedHashMap<>();
		Map<String, Boolean> checklist = checklist(body == null ? null : body.get("checklist"), errors);
		List<CheckFlags.Flag> flags = CheckFlags.read(body == null ? null : body.get("flags"), "flags", errors);
		if (!errors.isEmpty()) {
			throw new ValidationException("Manual check is not valid", errors);
		}
		return ApiResponse.success(checks.manualCheck(StaffGuard.staffId(request), uuid(id), checklist, flags));
	}

	@GetMapping("/content-checks/{id}")
	ApiResponse<ContentCheckService.Check> check(HttpServletRequest request, @PathVariable String id) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(checks.get(uuid(id)));
	}

	/** { resolution: "accepted", note } for warnings only; answers the whole check. */
	@PatchMapping("/content-check-flags/{id}")
	ApiResponse<ContentCheckService.Check> resolveFlag(HttpServletRequest request, @PathVariable String id,
			@RequestBody(required = false) JsonNode body) {
		StaffGuard.requireStaff(request);
		Map<String, String> errors = new LinkedHashMap<>();
		JsonNode resolution = body == null ? null : body.get("resolution");
		if (resolution == null || !resolution.isString()) {
			errors.put("resolution", "REQUIRED");
		}
		else if (!"accepted".equals(resolution.stringValue())) {
			errors.put("resolution", "INVALID");
		}
		JsonNode note = body == null ? null : body.get("note");
		if (note == null || !note.isString() || note.stringValue().isBlank()) {
			errors.put("note", "REQUIRED");
		}
		else if (note.stringValue().strip().length() > ContentCheckService.NOTE_MAX) {
			errors.put("note", "INVALID_LENGTH");
		}
		if (!errors.isEmpty()) {
			throw new ValidationException("Flag change is not valid", errors);
		}
		return ApiResponse.success(checks.accept(StaffGuard.staffId(request), uuid(id), note.stringValue().strip()));
	}

	@PostMapping("/content-items/{id}/publish")
	ApiResponse<ContentService.Detail> publish(HttpServletRequest request, @PathVariable String id) {
		StaffGuard.requireStaff(request);
		UUID itemId = uuid(id);
		publishing.publish(StaffGuard.staffId(request), itemId);
		return ApiResponse.success(content.get(itemId));
	}

	@PostMapping("/content-items/{id}/unpublish")
	ApiResponse<ContentService.Detail> unpublish(HttpServletRequest request, @PathVariable String id) {
		StaffGuard.requireStaff(request);
		UUID itemId = uuid(id);
		publishing.unpublish(StaffGuard.staffId(request), itemId);
		return ApiResponse.success(content.get(itemId));
	}

	private static Map<String, Boolean> checklist(JsonNode node, Map<String, String> errors) {
		Map<String, Boolean> out = new LinkedHashMap<>();
		if (node == null || !node.isObject()) {
			errors.put("checklist", node == null || node.isNull() ? "REQUIRED" : "INVALID");
			return out;
		}
		node.propertyNames().forEach(name -> {
			if (!ContentCheckService.CHECKLIST.contains(name)) {
				errors.put("checklist." + name, "INVALID");
			}
		});
		for (String item : ContentCheckService.CHECKLIST) {
			JsonNode value = node.get(item);
			if (value == null || !value.isBoolean()) {
				errors.put("checklist." + item, value == null || value.isNull() ? "REQUIRED" : "INVALID");
			}
			else {
				out.put(item, value.booleanValue());
			}
		}
		return out;
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
