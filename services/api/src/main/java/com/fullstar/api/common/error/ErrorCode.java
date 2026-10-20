package com.fullstar.api.common.error;

import org.springframework.http.HttpStatus;

/** Error codes and their HTTP status (Schema §10). Database codes are raised by the §6 functions. */
public enum ErrorCode {

	VALIDATION_FAILED(HttpStatus.BAD_REQUEST),

	UNAUTHENTICATED(HttpStatus.UNAUTHORIZED),
	PIN_REQUIRED(HttpStatus.UNAUTHORIZED),
	RECENT_LOGIN_REQUIRED(HttpStatus.UNAUTHORIZED),

	FORBIDDEN(HttpStatus.FORBIDDEN),
	CHILD_NOT_IN_FAMILY(HttpStatus.FORBIDDEN),
	ROLE_MISMATCH(HttpStatus.FORBIDDEN),

	NOT_FOUND(HttpStatus.NOT_FOUND),
	FAMILY_NOT_FOUND(HttpStatus.NOT_FOUND),

	CONFLICT(HttpStatus.CONFLICT),
	MAX_CHILDREN(HttpStatus.CONFLICT),
	BOOK_EXISTS(HttpStatus.CONFLICT),
	CHECK_NOT_PASSED(HttpStatus.CONFLICT),
	MAX_CLASS(HttpStatus.CONFLICT),
	BOOK_MISMATCH(HttpStatus.CONFLICT),
	/** Raised by versions_immutable; not listed in §10, treated as a blocked business rule. */
	VERSION_IMMUTABLE(HttpStatus.CONFLICT),

	UPLOAD_LIMIT(HttpStatus.CONTENT_TOO_LARGE),

	PIN_LOCKED(HttpStatus.LOCKED),

	RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS),
	READING_LIMIT(HttpStatus.TOO_MANY_REQUESTS),

	INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR),
	DEPENDENCY_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE),
	/** Trial mode: AI endpoints are switched off (Schema §12a). */
	FEATURE_DISABLED(HttpStatus.SERVICE_UNAVAILABLE);

	private final HttpStatus status;

	ErrorCode(HttpStatus status) {
		this.status = status;
	}

	public HttpStatus status() {
		return status;
	}

}
