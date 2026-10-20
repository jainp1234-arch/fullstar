package com.fullstar.api.common.error;

import java.util.Map;

public class RateLimitedException extends ApiException {

	public RateLimitedException(long retryAfterSeconds) {
		super(ErrorCode.RATE_LIMITED, "Too many requests, please try again later", Map.of(), retryAfterSeconds);
	}

}
