package com.fullstar.api.family.parent;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.web.ApiResponse;
import com.fullstar.api.family.account.FamilyAccountService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Children rows of Schema §11 (auth P; the first child is allowed with the token alone). */
@RestController
@RequestMapping("/api/v1/family/parent/children")
public class ChildrenController {

	private static final String FIRST_NAME = "first_name";

	private static final String AGE = "age";

	private static final String AVATAR_KEY = "avatar_key";

	private static final Set<String> EDITABLE = Set.of(FIRST_NAME, AGE, AVATAR_KEY);

	private final ChildrenService service;

	public ChildrenController(ChildrenService service) {
		this.service = service;
	}

	record AddChildRequest(@NotBlank String firstName, @NotNull @Min(4) @Max(12) Integer age,
			@NotNull @Min(1) @Max(5) Integer classLevel, @NotBlank String avatarKey) {
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<FamilyAccountService.Child> add(HttpServletRequest request, @Valid @RequestBody AddChildRequest body) {
		return ApiResponse.success(
				service.add(RequestActor.of(request), body.firstName(), body.age(), body.classLevel(), body.avatarKey()));
	}

	/** Partial: absent = unchanged, null = REQUIRED. class_level changes only through move-to-next-class. */
	@PatchMapping("/{id}")
	ApiResponse<FamilyAccountService.Child> update(HttpServletRequest request, @PathVariable String id,
			@RequestBody(required = false) JsonNode body) {
		UUID childId = parseId(id);
		return ApiResponse.success(service.update(RequestActor.of(request), childId, parse(body)));
	}

	@DeleteMapping("/{id}")
	ApiResponse<Map<String, UUID>> delete(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(Map.of("id", service.delete(RequestActor.of(request), parseId(id))));
	}

	@PostMapping("/{id}/move-to-next-class")
	ApiResponse<FamilyAccountService.Child> moveToNextClass(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(service.moveToNextClass(RequestActor.of(request), parseId(id)));
	}

	/** A malformed id is the same as an unknown one: never reveal anything. */
	private static UUID parseId(String id) {
		try {
			return UUID.fromString(id);
		}
		catch (IllegalArgumentException ex) {
			throw new NotFoundException();
		}
	}

	private static ChildrenService.Change parse(JsonNode body) {
		if (body == null || body.isMissingNode()) {
			return new ChildrenService.Change(null, null, null);
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
		String firstName = text(body, FIRST_NAME, errors);
		String avatarKey = text(body, AVATAR_KEY, errors);
		Integer age = null;
		JsonNode ageNode = body.get(AGE);
		if (ageNode != null) {
			if (ageNode.isInt()) {
				age = ageNode.intValue();
			}
			else {
				errors.put(AGE, ageNode.isNull() ? "REQUIRED" : "INVALID");
			}
		}
		if (!errors.isEmpty()) {
			throw new ValidationException("Child is not valid", errors);
		}
		return new ChildrenService.Change(firstName, age, avatarKey);
	}

	private static String text(JsonNode body, String name, Map<String, String> errors) {
		JsonNode node = body.get(name);
		if (node == null) {
			return null;
		}
		if (node.isString()) {
			return node.stringValue();
		}
		errors.put(name, node.isNull() ? "REQUIRED" : "INVALID");
		return null;
	}

}
