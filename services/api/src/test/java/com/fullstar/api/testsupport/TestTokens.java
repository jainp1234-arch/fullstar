package com.fullstar.api.testsupport;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.test.context.DynamicPropertyRegistry;

/**
 * A stand-in for Keycloak in tests: an RSA key published as a JWKS on a local port (JDK HTTP
 * server) and a builder for access tokens shaped like the realm's (iss, aud, sub, auth_time,
 * realm_access.roles).
 */
public final class TestTokens {

	public static final String ISSUER = "http://localhost:8080/auth/realms/fullstar";

	public static final String GRANT_SECRET = "test-parent-grant-secret-0123456789abcdef";

	private static final RSAKey KEY = generate("test-key");

	/** Same key id, different key: a forged token. */
	private static final RSAKey OTHER_KEY = generate("test-key");

	private static final HttpServer JWKS = startJwks();

	private TestTokens() {
	}

	public static void register(DynamicPropertyRegistry registry) {
		registry.add("fullstar.auth.issuer-uri", () -> ISSUER);
		registry.add("fullstar.auth.jwk-set-uri",
				() -> "http://127.0.0.1:" + JWKS.getAddress().getPort() + "/certs");
		registry.add("fullstar.auth.parent-grant-secret", () -> GRANT_SECRET);
	}

	public static Builder token() {
		return new Builder();
	}

	public static final class Builder {

		private String subject = UUID.randomUUID().toString();

		private String audience = "family-api";

		private String issuer = ISSUER;

		private Instant issuedAt = Instant.now();

		private Duration lifetime = Duration.ofMinutes(5);

		private Instant authTime = Instant.now();

		private List<String> roles = List.of();

		private boolean forged;

		public Builder subject(String value) {
			this.subject = value;
			return this;
		}

		public Builder audience(String value) {
			this.audience = value;
			return this;
		}

		public Builder issuer(String value) {
			this.issuer = value;
			return this;
		}

		public Builder expired() {
			this.issuedAt = Instant.now().minus(Duration.ofMinutes(10));
			this.lifetime = Duration.ofMinutes(5);
			return this;
		}

		public Builder authTime(Instant value) {
			this.authTime = value;
			return this;
		}

		public Builder roles(String... value) {
			this.roles = List.of(value);
			return this;
		}

		public Builder forged() {
			this.forged = true;
			return this;
		}

		public String subjectValue() {
			return subject;
		}

		public String build() {
			JWTClaimsSet claims = new JWTClaimsSet.Builder().issuer(issuer)
				.subject(subject)
				.audience(audience)
				.issueTime(Date.from(issuedAt))
				.expirationTime(Date.from(issuedAt.plus(lifetime)))
				.claim("auth_time", authTime.getEpochSecond())
				.claim("typ", "Bearer")
				.claim("realm_access", Map.of("roles", roles))
				.build();
			try {
				RSAKey key = forged ? OTHER_KEY : KEY;
				SignedJWT jwt = new SignedJWT(
						new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).type(JOSEObjectType.JWT).build(),
						claims);
				jwt.sign(new RSASSASigner(key));
				return jwt.serialize();
			}
			catch (Exception ex) {
				throw new IllegalStateException(ex);
			}
		}

		public String bearer() {
			return "Bearer " + build();
		}

	}

	private static RSAKey generate(String keyId) {
		try {
			return new RSAKeyGenerator(2048).keyID(keyId).generate();
		}
		catch (Exception ex) {
			throw new IllegalStateException(ex);
		}
	}

	private static HttpServer startJwks() {
		try {
			HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
			byte[] body = new JWKSet(KEY.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
			server.createContext("/certs", exchange -> {
				exchange.getResponseHeaders().add("Content-Type", "application/json");
				exchange.sendResponseHeaders(200, body.length);
				try (OutputStream out = exchange.getResponseBody()) {
					out.write(body);
				}
			});
			server.setExecutor(null);
			server.start();
			return server;
		}
		catch (Exception ex) {
			throw new IllegalStateException(ex);
		}
	}

}
