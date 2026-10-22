package com.fullstar.api.common.ratelimit;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Takes one permit of this per-family limit before the handler runs (Schema §10; Plan 9.2). Over
 * the limit the request answers 429 RATE_LIMITED with Retry-After. An Idempotency-Key replay is
 * answered before it and takes no permit.
 */
@Documented
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimited {

	RateLimitKind value();

}
