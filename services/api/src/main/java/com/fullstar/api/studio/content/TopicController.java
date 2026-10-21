package com.fullstar.api.studio.content;

import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.security.StaffGuard;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.LinkedHashMap;
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
import tools.jackson.databind.JsonNode;

/** GET · POST · PATCH /studio/topics (Schema §11, CA, S3). Archived topics stay in the tree. */
@RestController
@RequestMapping("/api/v1/studio/topics")
public class TopicController {

	/** Schema §4.2 topics.name varchar(120). */
	static final int NAME_MAX = 120;

	private static final Set<String> EDITABLE = Set.of("name", "sort_order", "archived");

	private final TopicService service;

	public TopicController(TopicService service) {
		this.service = service;
	}

	record AddTopicRequest(@NotNull @Min(1) @Max(5) Integer classLevel, @NotBlank String subject, String parentId,
			@NotBlank @Size(max = NAME_MAX) String name, @Min(0) @Max(100000) Integer sortOrder) {
	}

	@GetMapping
	ApiResponse<List<TopicService.Topic>> list(HttpServletRequest request,
			@RequestParam(name = "class", required = false) Integer classLevel,
			@RequestParam(required = false) String subject) {
		StaffGuard.requireStaff(request);
		if (classLevel != null && (classLevel < 1 || classLevel > 5)) {
			throw new ValidationException("class is out of range", Map.of("class", "OUT_OF_RANGE"));
		}
		return ApiResponse.success(service.list(classLevel, subject));
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<TopicService.Topic> add(HttpServletRequest request, @Valid @RequestBody AddTopicRequest body) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(service.create(StaffGuard.staffId(request), body.classLevel(), body.subject(),
				StudioIds.field(body.parentId(), "parent_id"), body.name().strip(),
				body.sortOrder() == null ? 0 : body.sortOrder()));
	}

	/** Partial: name, sort_order, archived. Class, subject and parent never change. */
	@PatchMapping("/{id}")
	ApiResponse<TopicService.Topic> update(HttpServletRequest request, @PathVariable String id,
			@RequestBody(required = false) JsonNode body) {
		StaffGuard.requireStaff(request);
		return ApiResponse.success(service.update(StudioIds.path(id), parse(body)));
	}

	private static TopicService.Change parse(JsonNode body) {
		if (body == null || body.isMissingNode()) {
			return new TopicService.Change(null, null, null);
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
		String name = null;
		JsonNode nameNode = body.get("name");
		if (nameNode != null) {
			if (!nameNode.isString() || nameNode.stringValue().isBlank()) {
				errors.put("name", nameNode.isString() || nameNode.isNull() ? "REQUIRED" : "INVALID");
			}
			else if (nameNode.stringValue().strip().length() > NAME_MAX) {
				errors.put("name", "INVALID_LENGTH");
			}
			else {
				name = nameNode.stringValue().strip();
			}
		}
		Integer sortOrder = null;
		JsonNode sortNode = body.get("sort_order");
		if (sortNode != null) {
			if (!sortNode.isInt()) {
				errors.put("sort_order", sortNode.isNull() ? "REQUIRED" : "INVALID");
			}
			else if (sortNode.intValue() < 0 || sortNode.intValue() > 100000) {
				errors.put("sort_order", "OUT_OF_RANGE");
			}
			else {
				sortOrder = sortNode.intValue();
			}
		}
		Boolean archived = null;
		JsonNode archivedNode = body.get("archived");
		if (archivedNode != null) {
			if (archivedNode.isBoolean()) {
				archived = archivedNode.booleanValue();
			}
			else {
				errors.put("archived", archivedNode.isNull() ? "REQUIRED" : "INVALID");
			}
		}
		if (!errors.isEmpty()) {
			throw new ValidationException("Topic change is not valid", errors);
		}
		return new TopicService.Change(name, sortOrder, archived);
	}

}
