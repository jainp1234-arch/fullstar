package com.fullstar.api.common.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;

/** Error part of the envelope. fields: field name to code; retry_after_s for 423 and 429. */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ApiError(String code, String message, Map<String, String> fields, Long retryAfterS) {

	public ApiError(String code, String message) {
		this(code, message, Map.of(), null);
	}

}
