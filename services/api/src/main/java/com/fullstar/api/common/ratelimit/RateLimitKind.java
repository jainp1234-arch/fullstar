package com.fullstar.api.common.ratelimit;

import java.time.Duration;

/** Per-family limits (Schema §10). */
public enum RateLimitKind {

	PIN_VERIFY(5, Duration.ofMinutes(1)),
	UPLOAD(20, Duration.ofHours(1)),
	WORKSHEET_CREATE(30, Duration.ofHours(1)),
	SYNC(60, Duration.ofMinutes(1)),
	SUPPORT(10, Duration.ofDays(1));

	private final int limit;

	private final Duration period;

	RateLimitKind(int limit, Duration period) {
		this.limit = limit;
		this.period = period;
	}

	public int limit() {
		return limit;
	}

	public Duration period() {
		return period;
	}

}
