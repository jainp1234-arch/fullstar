package com.fullstar.api.common.security;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * fullstar.auth.*: Keycloak issuer and keys (Schema §8.1) and the secret that signs parent grants
 * (Schema §8.2, HS256: at least 32 bytes).
 */
@Validated
@ConfigurationProperties("fullstar.auth")
public record AuthProperties(@NotBlank String issuerUri, @NotBlank String jwkSetUri,
		@NotBlank @Size(min = 32, message = "must be at least 32 characters") String parentGrantSecret) {

	public static final String FAMILY_AUDIENCE = "family-api";

	public static final String STUDIO_AUDIENCE = "studio-api";

}
