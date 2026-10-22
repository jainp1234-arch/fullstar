package com.fullstar.api.common.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

/** Plan 9.2: browsers may call the API only from the allow-listed origins, and get safe headers. */
class CorsTest extends ApiTestSupport {

	private static final String ALLOWED = "http://localhost:8080";

	@Test
	void anAllowedOriginPassesThePreflight() throws Exception {
		mvc.perform(options("/api/v1/family/kid/sync").header(HttpHeaders.ORIGIN, ALLOWED)
			.header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
			.header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type,x-child-id,idempotency-key"))
			.andExpect(status().isOk())
			.andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED))
			.andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS));
	}

	@Test
	void anotherOriginIsRefused() throws Exception {
		mvc.perform(options("/api/v1/family/kid/sync").header(HttpHeaders.ORIGIN, "https://evil.example")
			.header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
			.andExpect(status().isForbidden())
			.andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
		mvc.perform(get("/api/v1/public/health").header(HttpHeaders.ORIGIN, "https://evil.example"))
			.andExpect(status().isForbidden());
	}

	@Test
	void responsesCarryTheSecurityHeaders() throws Exception {
		mvc.perform(get("/api/v1/studio/content-items"))
			.andExpect(status().isUnauthorized())
			.andExpect(header().string("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"))
			.andExpect(header().string("X-Content-Type-Options", "nosniff"))
			.andExpect(header().string("X-Frame-Options", "DENY"))
			.andExpect(header().string("Referrer-Policy", "no-referrer"));
	}

}
