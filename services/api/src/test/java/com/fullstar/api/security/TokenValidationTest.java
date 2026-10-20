package com.fullstar.api.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.ResultActions;

/** Every 401 path of the resource server (Schema §8.1: issuer, signature, expiry, audience). */
class TokenValidationTest extends ApiTestSupport {

	private ResultActions callMe(String authorization) throws Exception {
		return authorization == null ? mvc.perform(get("/api/v1/family/me"))
				: mvc.perform(get("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, authorization));
	}

	private static void expectUnauthenticated(ResultActions result) throws Exception {
		result.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.status").value("error"))
			.andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
	}

	@Test
	void missingToken() throws Exception {
		expectUnauthenticated(callMe(null));
	}

	@Test
	void malformedToken() throws Exception {
		expectUnauthenticated(callMe("Bearer not-a-jwt"));
	}

	@Test
	void forgedSignature() throws Exception {
		expectUnauthenticated(callMe(TestTokens.token().forged().bearer()));
	}

	@Test
	void expiredToken() throws Exception {
		expectUnauthenticated(callMe(TestTokens.token().expired().bearer()));
	}

	@Test
	void wrongIssuer() throws Exception {
		expectUnauthenticated(callMe(TestTokens.token().issuer("http://evil.example/realms/fullstar").bearer()));
	}

	@Test
	void studioTokenIsRejectedByTheFamilyApi() throws Exception {
		expectUnauthenticated(callMe(TestTokens.token().audience("studio-api").bearer()));
	}

	@Test
	void familyTokenIsRejectedByTheStudioApi() throws Exception {
		expectUnauthenticated(mvc.perform(get("/api/v1/studio/me")
			.header(HttpHeaders.AUTHORIZATION, TestTokens.token().audience("family-api").bearer())));
	}

	@Test
	void validTokenWithoutFamilyIsFamilyNotFound() throws Exception {
		callMe(TestTokens.token().bearer()).andExpect(status().isNotFound())
			.andExpect(jsonPath("$.error.code").value("FAMILY_NOT_FOUND"));
	}

	@Test
	void pathsOutsideTheApiAreDenied() throws Exception {
		mvc.perform(get("/api/v1/anything").header(HttpHeaders.AUTHORIZATION, TestTokens.token().bearer()))
			.andExpect(status().isUnauthorized());
	}

}
