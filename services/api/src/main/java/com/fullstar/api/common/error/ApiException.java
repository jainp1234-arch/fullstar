package com.fullstar.api.common.error;

import java.util.Map;

/** Base for every business error; the advice turns it into the §10 error envelope. */
public class ApiException extends RuntimeException {

	private final ErrorCode code;

	private final transient Map<String, String> fields;

	private final Long retryAfterSeconds;

	public ApiException(ErrorCode code, String message) {
		this(code, message, Map.of(), null);
	}

	public ApiException(ErrorCode code, String message, Map<String, String> fields, Long retryAfterSeconds) {
		super(message);
		this.code = code;
		this.fields = fields == null ? Map.of() : Map.copyOf(fields);
		this.retryAfterSeconds = retryAfterSeconds;
	}

	public ErrorCode code() {
		return code;
	}

	public Map<String, String> fields() {
		return fields;
	}

	public Long retryAfterSeconds() {
		return retryAfterSeconds;
	}

}
