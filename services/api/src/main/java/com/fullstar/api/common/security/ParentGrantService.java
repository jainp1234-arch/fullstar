package com.fullstar.api.common.security;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Parent grant (Schema §8.2): a JWT signed by the API (HS256, secret from env) with sub,
 * family_id and scope=parent, valid 15 minutes, refreshed on every successful call.
 */
@Service
public class ParentGrantService {

	public static final String HEADER = "X-Parent-Grant";

	public static final Duration LIFETIME = Duration.ofMinutes(15);

	private static final String SCOPE = "parent";

	private final byte[] secret;

	private final Clock clock;

	@Autowired
	public ParentGrantService(AuthProperties auth) {
		this(auth, Clock.systemUTC());
	}

	ParentGrantService(AuthProperties auth, Clock clock) {
		this.secret = auth.parentGrantSecret().getBytes(StandardCharsets.UTF_8);
		this.clock = clock;
	}

	public record Grant(String token, long expiresInSeconds) {
	}

	public Grant issue(String subject, UUID familyId) {
		Instant now = clock.instant();
		JWTClaimsSet claims = new JWTClaimsSet.Builder().subject(subject)
			.claim("family_id", familyId.toString())
			.claim("scope", SCOPE)
			.issueTime(Date.from(now))
			.expirationTime(Date.from(now.plus(LIFETIME)))
			.jwtID(UUID.randomUUID().toString())
			.build();
		try {
			SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
			jwt.sign(new MACSigner(secret));
			return new Grant(jwt.serialize(), LIFETIME.toSeconds());
		}
		catch (JOSEException ex) {
			throw new IllegalStateException("Could not sign the parent grant", ex);
		}
	}

	/** True only for an unexpired HS256 grant with scope parent for this subject and family. */
	public boolean isValid(String token, String subject, UUID familyId) {
		return parse(token).filter(claims -> {
			Date expires = claims.getExpirationTime();
			return expires != null && expires.toInstant().isAfter(clock.instant())
					&& subject.equals(claims.getSubject()) && familyId.toString().equals(claim(claims, "family_id"))
					&& SCOPE.equals(claim(claims, "scope"));
		}).isPresent();
	}

	private Optional<JWTClaimsSet> parse(String token) {
		if (token == null || token.isBlank()) {
			return Optional.empty();
		}
		try {
			SignedJWT jwt = SignedJWT.parse(token.trim());
			if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm()) || !jwt.verify(new MACVerifier(secret))) {
				return Optional.empty();
			}
			return Optional.of(jwt.getJWTClaimsSet());
		}
		catch (ParseException | JOSEException ex) {
			return Optional.empty();
		}
	}

	private static String claim(JWTClaimsSet claims, String name) {
		Object value = claims.getClaim(name);
		return value == null ? null : value.toString();
	}

}
