package com.fullstar.api.family.account;

import com.fullstar.api.common.config.FullstarProperties;
import com.fullstar.api.common.db.DataSourceConfig;
import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.db.RlsSession;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.ratelimit.FamilyRateLimiter;
import com.fullstar.api.common.ratelimit.RateLimitKind;
import com.fullstar.api.common.security.ParentGrantService;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

/**
 * Family account and parent PIN (Schema §8.1, §8.2, §11 account rows). Runs inside the request
 * transaction as app_api. PIN failure counting uses app_system in its own atomic statement, so a
 * failed attempt is remembered even though the request itself rolls back.
 */
@Service
public class FamilyAccountService {

	/** Schema §8.2: 5 wrong PINs lock parent mode for 1 minute. */
	static final int MAX_PIN_FAILURES = 5;

	static final Duration PIN_LOCK = Duration.ofMinutes(1);

	/** Schema §8.2: PIN reset needs a sign-in less than 5 minutes old. */
	static final Duration FRESH_LOGIN = Duration.ofMinutes(5);

	private final JdbcTemplate jdbc;

	private final JdbcTemplate system;

	private final RlsSession rlsSession;

	private final FullstarProperties properties;

	private final ParentGrantService grants;

	private final FamilyRateLimiter rateLimiter;

	private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(12);

	private final Clock clock = Clock.systemUTC();

	public FamilyAccountService(JdbcTemplate jdbc, @Qualifier(DataSourceConfig.SYSTEM) JdbcTemplate system,
			RlsSession rlsSession, FullstarProperties properties, ParentGrantService grants,
			FamilyRateLimiter rateLimiter) {
		this.jdbc = jdbc;
		this.system = system;
		this.rlsSession = rlsSession;
		this.properties = properties;
		this.grants = grants;
		this.rateLimiter = rateLimiter;
	}

	public record Family(UUID id, String consentVersion, int dailyLimitMinutes, boolean soundEnabled,
			boolean celebrationsEnabled, boolean pinSet) {
	}

	public record Child(UUID id, String firstName, int age, int classLevel, String avatarKey, int starsTotal) {
	}

	public record Me(Family family, List<Child> children) {
	}

	public Me me(RequestActor actor) {
		UUID familyId = requireFamily(actor);
		List<Family> families = jdbc.query("""
				SELECT id, consent_version, daily_limit_minutes, sound_enabled, celebrations_enabled,
				       pin_hash IS NOT NULL AS pin_set
				  FROM app.families WHERE id = ?""",
				(rs, n) -> new Family(rs.getObject("id", UUID.class), rs.getString("consent_version"),
						rs.getInt("daily_limit_minutes"), rs.getBoolean("sound_enabled"),
						rs.getBoolean("celebrations_enabled"), rs.getBoolean("pin_set")),
				familyId);
		if (families.isEmpty()) {
			throw new ApiException(ErrorCode.FAMILY_NOT_FOUND, "Please finish signing up first");
		}
		List<Child> children = jdbc.query("""
				SELECT id, first_name, age, class_level, avatar_key, stars_total FROM app.children
				 ORDER BY created_at""",
				(rs, n) -> new Child(rs.getObject("id", UUID.class), rs.getString("first_name"), rs.getInt("age"),
						rs.getInt("class_level"), rs.getString("avatar_key"), rs.getInt("stars_total")));
		return new Me(families.get(0), children);
	}

	/** POST /family/me: create the family with the current consent version (Schema §8.1). */
	public Me create(RequestActor actor, String keycloakUserId, String consentVersion) {
		if (actor.kind() == RequestActor.Kind.PARENT) {
			throw new ApiException(ErrorCode.CONFLICT, "This account already has a family");
		}
		if (!properties.consent().version().equals(consentVersion)) {
			throw new ValidationException("consent_version is not the current version",
					Map.of("consent_version", "INVALID"));
		}
		UUID familyId = UUID.randomUUID();
		RequestActor parent = RequestActor.parent(familyId);
		// The new row must pass the families RLS policy (id = app.family_id)
		rlsSession.apply(parent);
		jdbc.update("INSERT INTO app.families (id, keycloak_user_id, consent_version, consent_at) VALUES (?, ?, ?, now())",
				familyId, keycloakUserId, consentVersion);
		return me(parent);
	}

	/** POST /family/pin: only when no PIN is set yet (B1). */
	public void setFirstPin(RequestActor actor, String pin) {
		UUID familyId = requireFamily(actor);
		int updated = jdbc.update("UPDATE app.families SET pin_hash = ? WHERE id = ? AND pin_hash IS NULL",
				bcrypt.encode(pin), familyId);
		if (updated == 0) {
			throw new ApiException(ErrorCode.CONFLICT, "A parent PIN is already set");
		}
	}

	/** POST /family/pin/verify: PIN → parent grant; 5 wrong tries lock for 1 minute (423). */
	public ParentGrantService.Grant verifyPin(RequestActor actor, String keycloakUserId, String pin) {
		UUID familyId = requireFamily(actor);
		Map<String, Object> row = jdbc.queryForMap("SELECT pin_hash, pin_locked_until FROM app.families WHERE id = ?",
				familyId);
		String hash = (String) row.get("pin_hash");
		if (hash == null) {
			throw new ApiException(ErrorCode.CONFLICT, "No parent PIN is set yet");
		}
		Instant lockedUntil = toInstant(row.get("pin_locked_until"));
		Instant now = clock.instant();
		if (lockedUntil != null && lockedUntil.isAfter(now)) {
			throw locked(lockedUntil, now);
		}
		rateLimiter.acquire(RateLimitKind.PIN_VERIFY, familyId);

		if (bcrypt.matches(pin, hash)) {
			system.update("UPDATE app.families SET pin_failed_count = 0, pin_locked_until = NULL WHERE id = ?", familyId);
			return grants.issue(keycloakUserId, familyId);
		}
		Map<String, Object> after = system.queryForMap("""
				UPDATE app.families
				   SET pin_failed_count = CASE WHEN pin_failed_count + 1 >= ? THEN 0 ELSE pin_failed_count + 1 END,
				       pin_locked_until = CASE WHEN pin_failed_count + 1 >= ? THEN now() + ?::interval ELSE pin_locked_until END
				 WHERE id = ?
				RETURNING pin_failed_count, pin_locked_until""", MAX_PIN_FAILURES, MAX_PIN_FAILURES,
				PIN_LOCK.toSeconds() + " seconds", familyId);
		Instant newLock = toInstant(after.get("pin_locked_until"));
		if (newLock != null && newLock.isAfter(now)) {
			throw locked(newLock, now);
		}
		int left = MAX_PIN_FAILURES - ((Number) after.get("pin_failed_count")).intValue();
		throw new ApiException(ErrorCode.PIN_REQUIRED, "That PIN is not right. " + left + " tries left",
				Map.of("pin", "WRONG"), null);
	}

	/** PUT /family/pin (Forgot PIN, A4): needs a sign-in less than 5 minutes old. */
	public void resetPin(RequestActor actor, Instant authTime, String pin) {
		UUID familyId = requireFamily(actor);
		if (authTime == null || authTime.isBefore(clock.instant().minus(FRESH_LOGIN))) {
			throw new ApiException(ErrorCode.RECENT_LOGIN_REQUIRED, "Please sign in again to reset the PIN");
		}
		jdbc.update("UPDATE app.families SET pin_hash = ?, pin_failed_count = 0, pin_locked_until = NULL WHERE id = ?",
				bcrypt.encode(pin), familyId);
	}

	private static ApiException locked(Instant lockedUntil, Instant now) {
		long seconds = Math.max(1, Duration.between(now, lockedUntil).toSeconds() + 1);
		return new ApiException(ErrorCode.PIN_LOCKED, "Too many wrong PINs. Try again in a minute or use Forgot PIN",
				Map.of(), seconds);
	}

	private static UUID requireFamily(RequestActor actor) {
		if (actor.kind() != RequestActor.Kind.PARENT) {
			throw new ApiException(ErrorCode.FAMILY_NOT_FOUND, "Please finish signing up first");
		}
		return actor.familyId();
	}

	private static Instant toInstant(Object value) {
		if (value instanceof Timestamp ts) {
			return ts.toInstant();
		}
		if (value instanceof java.time.OffsetDateTime odt) {
			return odt.toInstant();
		}
		return null;
	}

}
