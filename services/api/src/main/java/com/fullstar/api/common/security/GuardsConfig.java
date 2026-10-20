package com.fullstar.api.common.security;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration(proxyBeanMethods = false)
public class GuardsConfig implements WebMvcConfigurer {

	private final FamilyGuards familyGuards;

	public GuardsConfig(FamilyGuards familyGuards) {
		this.familyGuards = familyGuards;
	}

	@Override
	public void addInterceptors(InterceptorRegistry registry) {
		registry.addInterceptor(familyGuards.parentMode()).addPathPatterns("/api/v1/family/parent/**");
		registry.addInterceptor(familyGuards.kidMode()).addPathPatterns("/api/v1/family/kid/**");
	}

}
