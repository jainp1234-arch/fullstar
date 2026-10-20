package com.fullstar.keycloak.emailotp;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;

/**
 * One emailed code (Schema §8.1): 6 digits, valid 10 minutes, 5 tries, resend after 30 seconds.
 * Only a salted SHA-256 of the code is kept. Immutable; stored in the authentication session notes.
 */
public record OtpChallenge(String codeHash, String salt, Instant issuedAt, Instant lastSentAt, int attempts) {

	public static final int DIGITS = 6;

	public static final Duration VALIDITY = Duration.ofMinutes(10);

	public static final int MAX_ATTEMPTS = 5;

	public static final Duration RESEND_AFTER = Duration.ofSeconds(30);

	private static final SecureRandom RANDOM = new SecureRandom();

	public enum Verdict {

		/** Code matches and is still valid. */
		ACCEPTED,
		/** Wrong code; tries remain. */
		WRONG,
		/** Wrong code and no tries left: the code is spent, a new one is needed. */
		LOCKED,
		/** Older than 10 minutes. */
		EXPIRED

	}

	/** A new code and its challenge. The plain code is returned only to be emailed. */
	public record Issued(String code, OtpChallenge challenge) {
	}

	public static Issued issue(Instant now) {
		String code = String.format("%0" + DIGITS + "d", RANDOM.nextInt(1_000_000));
		byte[] saltBytes = new byte[16];
		RANDOM.nextBytes(saltBytes);
		String salt = HexFormat.of().formatHex(saltBytes);
		return new Issued(code, new OtpChallenge(hash(salt, code), salt, now, now, 0));
	}

	public boolean canResend(Instant now) {
		return !now.isBefore(lastSentAt.plus(RESEND_AFTER));
	}

	public long secondsUntilResend(Instant now) {
		long seconds = Duration.between(now, lastSentAt.plus(RESEND_AFTER)).toSeconds();
		return Math.max(0, seconds);
	}

	public boolean isSpent() {
		return attempts >= MAX_ATTEMPTS;
	}

	/** Checks a submitted code; returns the verdict and the challenge to keep. */
	public Result verify(String submitted, Instant now) {
		if (isSpent()) {
			return new Result(Verdict.LOCKED, this);
		}
		if (!now.isBefore(issuedAt.plus(VALIDITY))) {
			return new Result(Verdict.EXPIRED, this);
		}
		String normalized = submitted == null ? "" : submitted.replaceAll("\\s", "");
		boolean matches = normalized.matches("\\d{" + DIGITS + "}") && MessageDigest
			.isEqual(hash(salt, normalized).getBytes(StandardCharsets.US_ASCII), codeHash.getBytes(StandardCharsets.US_ASCII));
		if (matches) {
			return new Result(Verdict.ACCEPTED, this);
		}
		OtpChallenge next = new OtpChallenge(codeHash, salt, issuedAt, lastSentAt, attempts + 1);
		return new Result(next.isSpent() ? Verdict.LOCKED : Verdict.WRONG, next);
	}

	public int attemptsLeft() {
		return Math.max(0, MAX_ATTEMPTS - attempts);
	}

	public record Result(Verdict verdict, OtpChallenge challenge) {
	}

	// ---- authentication session notes ----

	static final String NOTE_HASH = "fullstar.otp.hash";

	static final String NOTE_SALT = "fullstar.otp.salt";

	static final String NOTE_ISSUED = "fullstar.otp.issued";

	static final String NOTE_SENT = "fullstar.otp.sent";

	static final String NOTE_ATTEMPTS = "fullstar.otp.attempts";

	public Map<String, String> toNotes() {
		return Map.of(NOTE_HASH, codeHash, NOTE_SALT, salt, NOTE_ISSUED, String.valueOf(issuedAt.toEpochMilli()),
				NOTE_SENT, String.valueOf(lastSentAt.toEpochMilli()), NOTE_ATTEMPTS, String.valueOf(attempts));
	}

	/** Returns null when the notes hold no (complete) challenge. */
	public static OtpChallenge fromNotes(Map<String, String> notes) {
		try {
			String hash = notes.get(NOTE_HASH);
			String salt = notes.get(NOTE_SALT);
			if (hash == null || salt == null) {
				return null;
			}
			return new OtpChallenge(hash, salt, Instant.ofEpochMilli(Long.parseLong(notes.get(NOTE_ISSUED))),
					Instant.ofEpochMilli(Long.parseLong(notes.get(NOTE_SENT))), Integer.parseInt(notes.get(NOTE_ATTEMPTS)));
		}
		catch (RuntimeException ex) {
			return null;
		}
	}

	static String[] noteNames() {
		return new String[] { NOTE_HASH, NOTE_SALT, NOTE_ISSUED, NOTE_SENT, NOTE_ATTEMPTS };
	}

	private static String hash(String salt, String code) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			return HexFormat.of().formatHex(digest.digest((salt + ":" + code).getBytes(StandardCharsets.UTF_8)));
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("SHA-256 unavailable", ex);
		}
	}

}
