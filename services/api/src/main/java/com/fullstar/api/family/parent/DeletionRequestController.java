package com.fullstar.api.family.parent;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.security.JwtActorResolver;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Data deletion request (Schema §11, auth P): 201 the first time, 200 with the same dates afterwards. */
@RestController
@RequestMapping("/api/v1/family/parent/deletion-request")
public class DeletionRequestController {

	private final DeletionRequestService service;

	public DeletionRequestController(DeletionRequestService service) {
		this.service = service;
	}

	record DeletionRequested(Instant requestedAt, Instant dueBy) {
	}

	@PostMapping
	ResponseEntity<ApiResponse<DeletionRequested>> request(HttpServletRequest request) {
		Jwt jwt = JwtActorResolver.currentJwt();
		DeletionRequestService.Result result = service.request(RequestActor.of(request), jwt.getSubject());
		return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
			.body(ApiResponse.success(new DeletionRequested(result.requestedAt(), result.dueBy())));
	}

}
