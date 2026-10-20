package com.fullstar.api.common.resilience;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fullstar.api.common.error.DependencyUnavailableException;
import com.fullstar.api.common.error.ErrorCode;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.RetryConfig;
import io.github.resilience4j.retry.RetryRegistry;
import io.github.resilience4j.timelimiter.TimeLimiterConfig;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class ResilientCallsTest {

	private final CircuitBreakerRegistry breakers = CircuitBreakerRegistry.of(CircuitBreakerConfig.custom()
		.slidingWindowSize(4)
		.minimumNumberOfCalls(4)
		.failureRateThreshold(50)
		.waitDurationInOpenState(Duration.ofMinutes(1))
		.build());

	private final RetryRegistry retries = RetryRegistry.of(RetryConfig.custom()
		.maxAttempts(3)
		.waitDuration(Duration.ofMillis(1))
		.ignoreExceptions(CallNotPermittedException.class)
		.build());

	private final TimeLimiterRegistry timeLimiters = TimeLimiterRegistry
		.of(TimeLimiterConfig.custom().timeoutDuration(Duration.ofMillis(200)).build());

	private final ResilientCalls calls = new ResilientCalls(breakers, retries, timeLimiters);

	@AfterEach
	void shutdown() {
		calls.destroy();
	}

	@Test
	void retriesTransientFailures() {
		AtomicInteger attempts = new AtomicInteger();
		String result = calls.call(Dependency.R2, () -> {
			if (attempts.incrementAndGet() < 3) {
				throw new IllegalStateException("flaky");
			}
			return "ok";
		});
		assertThat(result).isEqualTo("ok");
		assertThat(attempts).hasValue(3);
	}

	@Test
	void timeoutBecomesDependencyUnavailable() {
		assertThatThrownBy(() -> calls.call(Dependency.GOTENBERG, () -> {
			sleep(2_000);
			return "late";
		})).isInstanceOf(DependencyUnavailableException.class)
			.satisfies(ex -> assertThat(((DependencyUnavailableException) ex).code())
				.isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
	}

	@Test
	void openCircuitFailsFastWithoutCallingTheDependency() {
		AtomicInteger attempts = new AtomicInteger();
		for (int i = 0; i < 2; i++) {
			assertThatThrownBy(() -> calls.call(Dependency.SQS, () -> {
				attempts.incrementAndGet();
				throw new IllegalStateException("down");
			})).isInstanceOf(DependencyUnavailableException.class);
		}
		int before = attempts.get();
		assertThatThrownBy(() -> calls.call(Dependency.SQS, () -> {
			attempts.incrementAndGet();
			return "never";
		})).isInstanceOf(DependencyUnavailableException.class)
			.hasCauseInstanceOf(CallNotPermittedException.class);
		assertThat(attempts.get()).isEqualTo(before);
	}

	private static void sleep(long millis) {
		try {
			Thread.sleep(millis);
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
		}
	}

}
