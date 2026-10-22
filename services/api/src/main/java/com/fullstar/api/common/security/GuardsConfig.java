package com.fullstar.api.common.security;

import com.fullstar.api.common.ratelimit.RateLimitInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration(proxyBeanMethods = false)
public class GuardsConfig implements WebMvcConfigurer {

	private final FamilyGuards familyGuards;

	private final RateLimitInterceptor rateLimits;

	public GuardsConfig(FamilyGuards familyGuards, RateLimitInterceptor rateLimits) {
		this.familyGuards = familyGuards;
		this.rateLimits = rateLimits;
	}

	@Override
	public void addInterceptors(InterceptorRegistry registry) {
		registry.addInterceptor(familyGuards.parentMode()).addPathPatterns("/api/v1/family/parent/**");
		registry.addInterceptor(familyGuards.kidMode()).addPathPatterns("/api/v1/family/kid/**");
		// After the guards: only an allowed request takes a permit (Plan 9.2)
		registry.addInterceptor(rateLimits).addPathPatterns("/api/v1/family/**");
	}

}
