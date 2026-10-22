package com.fullstar.api.common.security;

import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.web.ErrorResponseWriter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Deny by default (Tech Stack §10). /api/v1/family/** accepts Keycloak tokens for family-api only,
 * /api/v1/studio/** for studio-api only (Schema §8.1, §8.3). Public endpoints and Actuator health and
 * Prometheus metrics (management port only) are open; everything else is 401.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityConfig {

	@Bean
	@Order(1)
	SecurityFilterChain familySecurity(HttpSecurity http, AuthProperties auth, ErrorResponseWriter errors,
			UrlBasedCorsConfigurationSource cors) throws Exception {
		return tokenChain(http.securityMatcher("/api/v1/family/**"),
				KeycloakJwtDecoders.forAudience(auth, AuthProperties.FAMILY_AUDIENCE), errors, cors);
	}

	@Bean
	@Order(2)
	SecurityFilterChain studioSecurity(HttpSecurity http, AuthProperties auth, ErrorResponseWriter errors,
			UrlBasedCorsConfigurationSource cors) throws Exception {
		return tokenChain(http.securityMatcher("/api/v1/studio/**"),
				KeycloakJwtDecoders.forAudience(auth, AuthProperties.STUDIO_AUDIENCE), errors, cors);
	}

	@Bean
	@Order(3)
	SecurityFilterChain apiSecurity(HttpSecurity http, ErrorResponseWriter errors, UrlBasedCorsConfigurationSource cors)
			throws Exception {
		common(http, errors, cors).authorizeHttpRequests(authorize -> authorize
			.requestMatchers(HttpMethod.GET, "/api/v1/public/**").permitAll()
			.requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
			// Plan 9.1: only on the management port (127.0.0.1:8091), which Caddy never proxies
			.requestMatchers(HttpMethod.GET, "/actuator/prometheus").permitAll()
			.requestMatchers("/v3/api-docs", "/v3/api-docs/**", "/swagger-ui.html", "/swagger-ui/**")
			.permitAll()
			.anyRequest()
			.denyAll());
		return http.build();
	}

	private static SecurityFilterChain tokenChain(HttpSecurity http, JwtDecoder decoder, ErrorResponseWriter errors,
			UrlBasedCorsConfigurationSource cors) throws Exception {
		common(http, errors, cors).authorizeHttpRequests(authorize -> authorize.anyRequest().authenticated())
			.oauth2ResourceServer(resource -> resource.jwt(jwt -> jwt.decoder(decoder))
				.authenticationEntryPoint((request, response, failure) -> errors.write(response,
						new ApiException(ErrorCode.UNAUTHENTICATED, "Please sign in")))
				.accessDeniedHandler((request, response, failure) -> errors.write(response,
						new ApiException(ErrorCode.FORBIDDEN, "Not allowed"))));
		return http.build();
	}

	private static HttpSecurity common(HttpSecurity http, ErrorResponseWriter errors, UrlBasedCorsConfigurationSource cors)
			throws Exception {
		// Bearer tokens, no cookies: no CSRF; cross-origin calls only from the allow-list (Plan 9.2)
		return http.cors(c -> c.configurationSource(cors))
			.csrf(csrf -> csrf.disable())
			.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.httpBasic(basic -> basic.disable())
			.formLogin(form -> form.disable())
			.logout(logout -> logout.disable())
			.exceptionHandling(ex -> ex
				.authenticationEntryPoint((request, response, failure) -> errors.write(response,
						new ApiException(ErrorCode.UNAUTHENTICATED, "Please sign in")))
				.accessDeniedHandler((request, response, failure) -> errors.write(response,
						new ApiException(ErrorCode.FORBIDDEN, "Not allowed"))))
			.headers(headers -> headers
				.contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'none'; frame-ancestors 'none'"))
				.referrerPolicy(referrer -> referrer.policy(ReferrerPolicy.NO_REFERRER))
				.httpStrictTransportSecurity(hsts -> hsts.maxAgeInSeconds(31_536_000).includeSubDomains(true)));
	}

}
