package com.fullstar.api.family.parent;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.web.ApiResponse;
import com.fullstar.api.family.account.FamilyAccountService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Children rows of Schema §11 (auth P; the first child is allowed with the token alone). */
@RestController
@RequestMapping("/api/v1/family/parent/children")
public class ChildrenController {

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

}
