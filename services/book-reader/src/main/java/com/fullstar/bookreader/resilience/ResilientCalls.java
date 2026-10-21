package com.fullstar.bookreader.resilience;

import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryRegistry;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/**
 * Retry with exponential backoff and circuit breaker around every outside call of book-reader
 * (r2, sqs, clamav; Tech Stack §10). Timeouts are set on each client (socket and call timeouts), so
 * a slow call fails and is retried here. A call that still fails throws its exception: the job is
 * then left on the queue and tried again later (max 3 receives, then the DLQ).
 */
@Component
public class ResilientCalls {

	public static final String R2 = "r2";

	public static final String SQS = "sqs";

	public static final String CLAMAV = "clamav";

	private final CircuitBreakerRegistry circuitBreakers;

	private final RetryRegistry retries;

	public ResilientCalls(CircuitBreakerRegistry circuitBreakers, RetryRegistry retries) {
		this.circuitBreakers = circuitBreakers;
		this.retries = retries;
	}

	public <T> T call(String dependency, Supplier<T> call) {
		CircuitBreaker breaker = circuitBreakers.circuitBreaker(dependency);
		Retry retry = retries.retry(dependency);
		return Retry.decorateSupplier(retry, CircuitBreaker.decorateSupplier(breaker, call)).get();
	}

	public void run(String dependency, Runnable call) {
		call(dependency, () -> {
			call.run();
			return null;
		});
	}

}
