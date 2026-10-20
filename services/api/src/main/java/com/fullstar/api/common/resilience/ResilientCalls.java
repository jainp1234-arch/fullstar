package com.fullstar.api.common.resilience;

import com.fullstar.api.common.error.DependencyUnavailableException;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryRegistry;
import io.github.resilience4j.timelimiter.TimeLimiter;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

/**
 * Wraps every outside call (Claude, R2, SQS, Gotenberg) in timeout, retry with exponential
 * backoff and circuit breaker (Tech Stack §10). Instances and their settings come from the
 * resilience4j.* properties; a call that cannot complete becomes DEPENDENCY_UNAVAILABLE (503).
 */
@Component
public class ResilientCalls implements DisposableBean {

	private static final Logger log = LoggerFactory.getLogger(ResilientCalls.class);

	private final CircuitBreakerRegistry circuitBreakers;

	private final RetryRegistry retries;

	private final TimeLimiterRegistry timeLimiters;

	private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

	public ResilientCalls(CircuitBreakerRegistry circuitBreakers, RetryRegistry retries,
			TimeLimiterRegistry timeLimiters) {
		this.circuitBreakers = circuitBreakers;
		this.retries = retries;
		this.timeLimiters = timeLimiters;
	}

	/** Runs the call as the named dependency (r2, sqs, claude, gotenberg). */
	public <T> T call(Dependency dependency, Supplier<T> call) {
		String name = dependency.instanceName();
		CircuitBreaker circuitBreaker = circuitBreakers.circuitBreaker(name);
		Retry retry = retries.retry(name);
		TimeLimiter timeLimiter = timeLimiters.timeLimiter(name);

		Supplier<T> timed = () -> {
			try {
				return timeLimiter.executeFutureSupplier(() -> CompletableFuture.supplyAsync(call, executor));
			}
			catch (RuntimeException ex) {
				throw ex;
			}
			catch (Exception ex) {
				throw new DependencyCallException(ex);
			}
		};
		Supplier<T> protectedCall = Retry.decorateSupplier(retry, CircuitBreaker.decorateSupplier(circuitBreaker, timed));
		try {
			return protectedCall.get();
		}
		catch (CallNotPermittedException ex) {
			log.warn("Circuit open for {}", name);
			throw new DependencyUnavailableException(name, ex);
		}
		catch (DependencyCallException ex) {
			log.warn("Call to {} failed: {}", name, ex.getCause() instanceof TimeoutException ? "timeout"
					: ex.getCause().getClass().getSimpleName());
			throw new DependencyUnavailableException(name, ex.getCause());
		}
		catch (RuntimeException ex) {
			log.warn("Call to {} failed: {}", name, ex.getClass().getSimpleName());
			throw new DependencyUnavailableException(name, ex);
		}
	}

	@Override
	public void destroy() {
		executor.shutdownNow();
	}

	/** Checked failures (timeout, interruption) from inside the decorated call. */
	private static final class DependencyCallException extends RuntimeException {

		DependencyCallException(Exception cause) {
			super(cause);
		}

	}

}
