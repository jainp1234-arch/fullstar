package com.fullstar.api.common.security;

import java.util.List;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * Keycloak access-token decoders (Schema §8.1, §8.3): RS256 signature from the realm JWKS, issuer,
 * expiry and one required audience (family-api or studio-api).
 */
public final class KeycloakJwtDecoders {

	private KeycloakJwtDecoders() {
	}

	public static JwtDecoder forAudience(AuthProperties auth, String audience) {
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(auth.jwkSetUri())
			.jwsAlgorithm(SignatureAlgorithm.RS256)
			.build();
		OAuth2TokenValidator<Jwt> validator = new DelegatingOAuth2TokenValidator<>(
				JwtValidators.createDefaultWithIssuer(auth.issuerUri()), audienceValidator(audience));
		decoder.setJwtValidator(validator);
		return decoder;
	}

	static OAuth2TokenValidator<Jwt> audienceValidator(String audience) {
		OAuth2Error error = new OAuth2Error("invalid_token", "The token is not for " + audience, null);
		return jwt -> {
			List<String> audiences = jwt.getAudience();
			return audiences != null && audiences.contains(audience) ? OAuth2TokenValidatorResult.success()
					: OAuth2TokenValidatorResult.failure(error);
		};
	}

}
