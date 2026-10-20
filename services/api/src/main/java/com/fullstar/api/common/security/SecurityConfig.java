package com.fullstar.api.common.security;

import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.web.ErrorResponseWriter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Deny by default (Tech Stack §10). Public endpoints and Actuator health are open; everything
 * else needs a token, which step 1.5 adds (Keycloak resource server). Until then other paths answer
 * 401 UNAUTHENTICATED.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityConfig {

	@Bean
	SecurityFilterChain apiSecurity(HttpSecurity http, ErrorResponseWriter errors) throws Exception {
		http.csrf(csrf -> csrf.disable())
			.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.httpBasic(basic -> basic.disable())
			.formLogin(form -> form.disable())
			.logout(logout -> logout.disable())
			.authorizeHttpRequests(auth -> auth
				.requestMatchers(HttpMethod.GET, "/api/v1/public/**").permitAll()
				.requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
				.requestMatchers("/v3/api-docs", "/v3/api-docs/**", "/swagger-ui.html", "/swagger-ui/**")
				.permitAll()
				.anyRequest()
				.authenticated())
			.exceptionHandling(ex -> ex
				.authenticationEntryPoint((request, response, failure) -> errors.write(response,
						new ApiException(ErrorCode.UNAUTHENTICATED, "Please sign in")))
				.accessDeniedHandler((request, response, failure) -> errors.write(response,
						new ApiException(ErrorCode.FORBIDDEN, "Not allowed"))))
			.headers(headers -> headers.contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'none'; frame-ancestors 'none'")));
		return http.build();
	}

}
