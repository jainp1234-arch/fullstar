package com.fullstar.api.family.reading;

import com.fullstar.api.common.jobs.JobResult;
import com.fullstar.api.common.jobs.JobResultHandler;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * Applies a reading-score result (Schema §12; Plan 8.3, decided 22 Oct 2026), once per job, as
 * app_system. Scored: accuracy, words per minute, words to practise, and stars on the attempt
 * (over 80% 3, over 50% 2, else 1); two scored tests in a row at the child's level with 90% or more
 * move the level up one (3 at most). Not understood: no score and no stars. A failure is "failed".
 */
@Component
public class ReadingScoreResultHandler implements JobResultHandler {

	private static final Logger log = LoggerFactory.getLogger(ReadingScoreResultHandler.class);

	static final BigDecimal LEVEL_UP_PCT = BigDecimal.valueOf(90);

	static final int MAX_LEVEL = 3;

	static final int MAX_PRACTISE = 5;

	@Override
	public String type() {
		return ReadingService.SCORE_JOB;
	}

	@Override
	public void apply(JobResult result, JdbcTemplate system) {
		// Keys are "reading.score:<reading test id>"
		String[] key = result.idempotencyKey().split(":");
		if (key.length != 2) {
			log.warn("Reading result with an unknown key ignored");
			return;
		}
		UUID testId = UUID.fromString(key[1]);
		List<Map<String, Object>> rows = system.queryForList("""
				SELECT r.status, r.attempt_id, r.child_id FROM app.reading_tests r WHERE r.id = ? FOR UPDATE""", testId);
		if (rows.isEmpty() || !"processing".equals(rows.get(0).get("status"))) {
			log.info("Reading result ignored readingTestId={}", testId);
			return;
		}
		UUID attemptId = (UUID) rows.get(0).get("attempt_id");
		UUID childId = (UUID) rows.get(0).get("child_id");
		if (!result.succeeded()) {
			system.update("UPDATE app.reading_tests SET status = 'failed' WHERE id = ?", testId);
			system.update("UPDATE app.activity_attempts SET completed_at = now() WHERE id = ?", attemptId);
			log.error("Reading scoring failed readingTestId={}", testId);
			return;
		}
		JsonNode score = result.result();
		String transcript = limit(score.path("transcript").asString(""), 10_000);
		if (!"scored".equals(score.path("outcome").asString())) {
			system.update("""
					UPDATE app.reading_tests SET status = 'not_understood', transcript = ? WHERE id = ?""", transcript,
					testId);
			system.update("UPDATE app.activity_attempts SET completed_at = now(), stars = 0 WHERE id = ?", attemptId);
			log.info("Reading not understood readingTestId={}", testId);
			return;
		}
		BigDecimal accuracy = clamp(score.path("accuracy_pct").decimalValue(), BigDecimal.valueOf(100));
		BigDecimal wpm = clamp(score.path("words_per_minute").decimalValue(), BigDecimal.valueOf(9999));
		int wordCount = Math.max(1, score.path("word_count").asInt(1));
		int wordsRead = Math.min(wordCount, Math.max(0, score.path("words_read").asInt(0)));
		List<String> practise = new ArrayList<>();
		for (JsonNode word : score.path("words_to_practise")) {
			if (practise.size() < MAX_PRACTISE && word.isString() && !word.asString().isBlank()) {
				practise.add(limit(word.asString(), 60));
			}
		}
		system.update("""
				UPDATE app.reading_tests SET status = 'scored', transcript = ?, accuracy_pct = ?, words_per_minute = ?,
				       words_to_practise = ? WHERE id = ?""", transcript, accuracy, wpm,
				practise.toArray(String[]::new), testId);
		system.update("""
				UPDATE app.activity_attempts SET completed_at = now(), correct_count = ?, total_count = ?, stars = ?
				 WHERE id = ?""", wordsRead, wordCount, stars(accuracy), attemptId);
		levelUp(system, childId);
		log.info("Reading scored readingTestId={}", testId);
	}

	/** Same steps as every activity: over 80% 3 stars, over 50% 2, else 1. */
	static int stars(BigDecimal accuracy) {
		if (accuracy.compareTo(BigDecimal.valueOf(80)) > 0) {
			return 3;
		}
		return accuracy.compareTo(BigDecimal.valueOf(50)) > 0 ? 2 : 1;
	}

	/** The child's last two scored tests both at their level with 90% or more: one level up. */
	private static void levelUp(JdbcTemplate system, UUID childId) {
		Integer level = system.queryForObject("SELECT reading_level FROM app.children WHERE id = ? FOR UPDATE",
				Integer.class, childId);
		if (level == null || level >= MAX_LEVEL) {
			return;
		}
		List<Map<String, Object>> last = system.queryForList("""
				SELECT r.accuracy_pct, COALESCE((cv.body->>'level')::int, 1) AS level
				  FROM app.reading_tests r JOIN app.content_versions cv ON cv.id = r.passage_version_id
				 WHERE r.child_id = ? AND r.status = 'scored' ORDER BY r.created_at DESC LIMIT 2""", childId);
		boolean strong = last.size() == 2 && last.stream()
			.allMatch(t -> ((Number) t.get("level")).intValue() == level
					&& ((BigDecimal) t.get("accuracy_pct")).compareTo(LEVEL_UP_PCT) >= 0);
		if (strong) {
			system.update("UPDATE app.children SET reading_level = ? WHERE id = ?", level + 1, childId);
			log.info("Reading level up childId={} level={}", childId, level + 1);
		}
	}

	private static BigDecimal clamp(BigDecimal value, BigDecimal max) {
		BigDecimal positive = value.max(BigDecimal.ZERO);
		return positive.min(max);
	}

	private static String limit(String text, int max) {
		return text.length() <= max ? text : text.substring(0, max);
	}

}
