package com.fullstar.api.common.ratelimit;

import com.fullstar.api.common.db.RequestActor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/** Applies {@link RateLimited} to family endpoints, after the parent/kid guards (Plan 9.2). */
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

	private final FamilyRateLimiter limiter;

	public RateLimitInterceptor(FamilyRateLimiter limiter) {
		this.limiter = limiter;
	}

	@Override
	public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
		if (handler instanceof HandlerMethod method) {
			RateLimited limit = method.getMethodAnnotation(RateLimited.class);
			UUID familyId = RequestActor.of(request).familyId();
			if (limit != null && familyId != null) {
				limiter.acquire(limit.value(), familyId);
			}
		}
		return true;
	}

}
