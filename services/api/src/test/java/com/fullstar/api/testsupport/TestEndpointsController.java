package com.fullstar.api.testsupport;

import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.ratelimit.FamilyRateLimiter;
import com.fullstar.api.common.ratelimit.RateLimitKind;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Test-only endpoints exercising the request pipeline (test classpath only). */
@RestController
@RequestMapping("/api/v1/test")
class TestEndpointsController {

	private final JdbcTemplate jdbc;

	private final FamilyRateLimiter rateLimiter;

	TestEndpointsController(JdbcTemplate jdbc, FamilyRateLimiter rateLimiter) {
		this.jdbc = jdbc;
		this.rateLimiter = rateLimiter;
	}

	record Session(String actor, String familyId, String staffRole) {
	}

	@GetMapping("/session")
	ApiResponse<Session> session() {
		// SET LOCAL values exist only inside the filter's transaction, so seeing them proves the request ran in it.
		Map<String, Object> row = jdbc.queryForMap("""
				SELECT current_setting('app.actor', true) AS actor, current_setting('app.family_id', true) AS family,
				       current_setting('app.staff_role', true) AS role""");
		return ApiResponse.success(new Session((String) row.get("actor"), (String) row.get("family"), (String) row.get("role")));
	}

	@GetMapping("/children/count")
	ApiResponse<Long> childrenCount() {
		return ApiResponse.success(jdbc.queryForObject("SELECT count(*) FROM app.children", Long.class));
	}

	record ChildRequest(@NotBlank @Size(max = 40) String firstName, @NotNull @Min(4) @Max(12) Integer age) {
	}

	@PostMapping("/children")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<UUID> addChild(@Valid @RequestBody ChildRequest body) {
		return ApiResponse.success(jdbc.queryForObject("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (app.current_family(), ?, ?, 3, 'cat') RETURNING id""", UUID.class, body.firstName(),
				body.age().shortValue()));
	}

	record EventRequest(@NotBlank String tag) {
	}

	/** token is new on every execution, so a replayed response is recognisable. */
	record EventResult(String tag, UUID token) {
	}

	@PostMapping("/events")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<EventResult> addEvent(@Valid @RequestBody EventRequest body) {
		// No RETURNING: usage_events are readable by super admins only, so RLS would refuse it.
		jdbc.update("INSERT INTO app.usage_events (event_type) VALUES (?)", body.tag());
		return ApiResponse.success(new EventResult(body.tag(), UUID.randomUUID()));
	}

	@PostMapping("/events/other")
	@ResponseStatus(HttpStatus.CREATED)
	ApiResponse<EventResult> addOtherEvent(@Valid @RequestBody EventRequest body) {
		return addEvent(body);
	}

	@PostMapping("/events/fail")
	ApiResponse<EventResult> addEventThenFail(@Valid @RequestBody EventRequest body) {
		jdbc.update("INSERT INTO app.usage_events (event_type) VALUES (?)", body.tag());
		throw new ApiException(ErrorCode.CONFLICT, "Blocked after writing");
	}

	@GetMapping("/boom")
	ApiResponse<Void> boom() {
		throw new IllegalStateException("internal detail that must not leak");
	}

	@GetMapping("/missing")
	ApiResponse<Void> missing() {
		throw new NotFoundException();
	}

	@PostMapping("/pin-verify")
	ApiResponse<String> limited() {
		UUID family = jdbc.queryForObject("SELECT app.current_family()", UUID.class);
		rateLimiter.acquire(RateLimitKind.PIN_VERIFY, family);
		return ApiResponse.success("ok");
	}

}
