package com.fullstar.keycloak.emailotp;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class OtpChallengeTest {

	private static final Instant T0 = Instant.parse("2026-10-20T10:00:00Z");

	@Test
	void codesHaveSixDigitsAndVary() {
		Set<String> codes = new HashSet<>();
		for (int i = 0; i < 200; i++) {
			String code = OtpChallenge.issue(T0).code();
			assertThat(code).matches("\\d{6}");
			codes.add(code);
		}
		assertThat(codes).hasSizeGreaterThan(190);
	}

	@Test
	void onlyASaltedHashIsKept() {
		OtpChallenge.Issued first = OtpChallenge.issue(T0);
		assertThat(first.challenge().toNotes().values()).noneMatch(v -> v.equals(first.code()));
		assertThat(first.challenge().codeHash()).hasSize(64).doesNotContain(first.code());
		OtpChallenge.Issued second = OtpChallenge.issue(T0);
		assertThat(second.challenge().salt()).isNotEqualTo(first.challenge().salt());
	}

	@Test
	void rightCodeIsAcceptedWithinTenMinutes() {
		OtpChallenge.Issued issued = OtpChallenge.issue(T0);
		assertThat(issued.challenge().verify(issued.code(), T0.plus(Duration.ofMinutes(9))).verdict())
			.isEqualTo(OtpChallenge.Verdict.ACCEPTED);
		assertThat(issued.challenge().verify(" " + issued.code().substring(0, 3) + " " + issued.code().substring(3), T0)
			.verdict()).isEqualTo(OtpChallenge.Verdict.ACCEPTED);
	}

	@Test
	void codeExpiresAfterTenMinutes() {
		OtpChallenge.Issued issued = OtpChallenge.issue(T0);
		assertThat(issued.challenge().verify(issued.code(), T0.plus(OtpChallenge.VALIDITY)).verdict())
			.isEqualTo(OtpChallenge.Verdict.EXPIRED);
	}

	@Test
	void fiveWrongTriesSpendTheCodeEvenForTheRightOneAfterwards() {
		OtpChallenge.Issued issued = OtpChallenge.issue(T0);
		String wrong = issued.code().equals("000000") ? "111111" : "000000";
		OtpChallenge challenge = issued.challenge();
		for (int i = 1; i <= 4; i++) {
			OtpChallenge.Result result = challenge.verify(wrong, T0);
			assertThat(result.verdict()).isEqualTo(OtpChallenge.Verdict.WRONG);
			challenge = result.challenge();
			assertThat(challenge.attemptsLeft()).isEqualTo(5 - i);
		}
		OtpChallenge.Result fifth = challenge.verify(wrong, T0);
		assertThat(fifth.verdict()).isEqualTo(OtpChallenge.Verdict.LOCKED);
		assertThat(fifth.challenge().verify(issued.code(), T0).verdict()).isEqualTo(OtpChallenge.Verdict.LOCKED);
	}

	@Test
	void malformedInputCountsAsAWrongTry() {
		OtpChallenge.Issued issued = OtpChallenge.issue(T0);
		for (String input : new String[] { null, "", "12345", "1234567", "abcdef" }) {
			OtpChallenge.Result result = issued.challenge().verify(input, T0);
			assertThat(result.verdict()).isEqualTo(OtpChallenge.Verdict.WRONG);
			assertThat(result.challenge().attempts()).isEqualTo(1);
		}
	}

	@Test
	void resendIsAllowedAfterThirtySeconds() {
		OtpChallenge challenge = OtpChallenge.issue(T0).challenge();
		assertThat(challenge.canResend(T0.plusSeconds(29))).isFalse();
		assertThat(challenge.secondsUntilResend(T0.plusSeconds(10))).isEqualTo(20);
		assertThat(challenge.canResend(T0.plusSeconds(30))).isTrue();
	}

	@Test
	void notesRoundTripAndBadNotesAreIgnored() {
		OtpChallenge.Issued issued = OtpChallenge.issue(T0);
		OtpChallenge restored = OtpChallenge.fromNotes(issued.challenge().verify("999999", T0).challenge().toNotes());
		assertThat(restored.attempts()).isEqualTo(issued.code().equals("999999") ? 0 : 1);
		assertThat(restored.verify(issued.code(), T0).verdict()).isEqualTo(OtpChallenge.Verdict.ACCEPTED);
		assertThat(OtpChallenge.fromNotes(java.util.Map.of())).isNull();
		assertThat(OtpChallenge.fromNotes(java.util.Map.of(OtpChallenge.NOTE_HASH, "x", OtpChallenge.NOTE_SALT, "y",
				OtpChallenge.NOTE_ISSUED, "not-a-number", OtpChallenge.NOTE_SENT, "1", OtpChallenge.NOTE_ATTEMPTS, "0")))
			.isNull();
	}

}
