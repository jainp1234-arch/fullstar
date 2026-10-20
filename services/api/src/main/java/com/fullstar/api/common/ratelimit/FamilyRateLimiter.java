package com.fullstar.api.common.ratelimit;

import com.fullstar.api.common.error.RateLimitedException;
import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RateLimiterConfig;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import io.github.resilience4j.ratelimiter.internal.AtomicRateLimiter;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Resilience4j RateLimiter per family and kind (Schema §10). Limiters live in memory on this
 * instance; that is enough for the single demo server.
 */
@Component
public class FamilyRateLimiter {

	private final RateLimiterRegistry registry;

	private final Map<RateLimitKind, RateLimiterConfig> configs = new EnumMap<>(RateLimitKind.class);

	public FamilyRateLimiter() {
		this.registry = RateLimiterRegistry.ofDefaults();
		for (RateLimitKind kind : RateLimitKind.values()) {
			configs.put(kind, RateLimiterConfig.custom()
				.limitForPeriod(kind.limit())
				.limitRefreshPeriod(kind.period())
				.timeoutDuration(Duration.ZERO)
				.build());
		}
	}

	/** Takes one permit or throws RATE_LIMITED with the wait in seconds. */
	public void acquire(RateLimitKind kind, UUID familyId) {
		RateLimiter limiter = registry.rateLimiter(kind.name() + ":" + familyId, configs.get(kind));
		if (!limiter.acquirePermission()) {
			long waitNanos = limiter instanceof AtomicRateLimiter atomic
					? Math.max(0, atomic.getDetailedMetrics().getNanosToWait()) : kind.period().toNanos();
			long seconds = (waitNanos + 999_999_999L) / 1_000_000_000L;
			throw new RateLimitedException(Math.max(1, seconds));
		}
	}

}
