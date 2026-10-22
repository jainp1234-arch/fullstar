package com.fullstar.api.common.security;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * CORS allow-list (Plan 9.2): only the family app and Studio origins may call /api/v1 from a browser.
 * Trial: both are on http://localhost:8080 (same origin through Caddy), which is the default. No
 * cookies are used, so credentials stay off.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(CorsConfig.CorsProperties.class)
public class CorsConfig {

	@ConfigurationProperties("fullstar.cors")
	public record CorsProperties(List<String> allowedOrigins) {

		public CorsProperties {
			allowedOrigins = allowedOrigins == null ? List.of()
					: allowedOrigins.stream().map(String::strip).filter(o -> !o.isEmpty()).toList();
			for (String origin : allowedOrigins) {
				if (origin.contains("*")) {
					throw new IllegalArgumentException("fullstar.cors.allowed-origins takes exact origins, not " + origin);
				}
			}
		}

	}

	@Bean
	UrlBasedCorsConfigurationSource corsConfigurationSource(CorsProperties properties) {
		CorsConfiguration api = new CorsConfiguration();
		api.setAllowedOrigins(properties.allowedOrigins());
		api.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE"));
		api.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key", "X-Parent-Grant", "X-Child-Id",
				"X-Request-Id"));
		api.setExposedHeaders(List.of("Retry-After", "Idempotent-Replayed", "X-Request-Id"));
		api.setAllowCredentials(false);
		api.setMaxAge(Duration.ofMinutes(10));
		UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
		source.registerCorsConfiguration("/api/v1/**", api);
		return source;
	}

}
