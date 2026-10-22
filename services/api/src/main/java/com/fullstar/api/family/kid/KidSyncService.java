package com.fullstar.api.family.kid;

import com.fullstar.api.common.db.RequestActor;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Offline events from the device (Schema §11 POST /family/kid/sync; Plan 6.2). Attempts upsert by
 * their device id: a completed attempt is never replaced by older progress, and a later completion
 * wins. Answers and minutes insert once. Stars are computed here from the counts; the device never
 * sends them. Events that do not belong to this child or name content the family cannot read are
 * skipped (counted as rejected), so one bad event never blocks the device's queue.
 */
@Service
public class KidSyncService {

	private static final Logger log = LoggerFactory.getLogger(KidSyncService.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	/** Activities with a device-side player so far; worksheets and reading tests come with their steps. */
	static final Set<String> KINDS = Set.of("lesson", "readalong", "practice", "tables", "tables_challenge");

	/** A device may be offline for a while, but not for ever; minutes from the future are clock errors. */
	private static final Duration OLDEST = Duration.ofDays(14);

	private static final Duration CLOCK_SKEW = Duration.ofMinutes(2);

	static final int ANSWER_MAX_CHARS = 2_000;

	private static final String TODAY_START = "date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'";

	private final JdbcTemplate jdbc;

	public KidSyncService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Attempt(UUID id, String kind, int subjectId, UUID contentItemId, UUID contentVersionId,
			UUID familyChapterId, UUID topicId, Instant startedAt, Instant completedAt, Integer correctCount,
			Integer totalCount, int durationSeconds, JsonNode resumeState) {
	}

	public record Answer(UUID id, UUID attemptId, UUID questionItemId, UUID questionVersionId, boolean isCorrect,
			JsonNode answer, Instant answeredAt) {
	}

	public record Counts(int attempts, int answers, int minutes) {
	}

	public record Result(int starsTotal, int minutesToday, Counts accepted, Counts rejected) {
	}

	/** Schema §11: 0 of anything = 1 star for trying; over 50% = 2; over 80% = 3. */
	static int stars(Integer correct, Integer total) {
		if (correct == null || total == null || total == 0) {
			return 1;
		}
		double share = (double) correct / total;
		return share > 0.8 ? 3 : share > 0.5 ? 2 : 1;
	}

	public Result sync(RequestActor actor, UUID childId, List<Attempt> attempts, List<Answer> answers,
			List<Instant> minutes) {
		int attemptsOk = 0;
		for (Attempt attempt : attempts) {
			attemptsOk += saveAttempt(actor.familyId(), childId, attempt) ? 1 : 0;
		}
		int answersOk = 0;
		for (Answer answer : answers) {
			answersOk += saveAnswer(actor.familyId(), childId, answer) ? 1 : 0;
		}
		int minutesOk = 0;
		Instant now = Instant.now();
		for (Instant minute : minutes) {
			Instant at = minute.truncatedTo(ChronoUnit.MINUTES);
			if (at.isBefore(now.minus(OLDEST)) || at.isAfter(now.plus(CLOCK_SKEW))) {
				continue;
			}
			// A repeated minute is not an error: it was counted already
			jdbc.update("""
					INSERT INTO app.usage_minutes (child_id, minute_at, family_id) VALUES (?, ?, ?)
					ON CONFLICT (child_id, minute_at) DO NOTHING""", childId, Timestamp.from(at), actor.familyId());
			minutesOk++;
		}
		Map<String, Object> totals = jdbc.queryForMap("""
				SELECT c.stars_total,
				       (SELECT count(*) FROM app.usage_minutes u WHERE u.child_id = c.id AND u.minute_at >= %s) AS minutes
				  FROM app.children c WHERE c.id = ?""".formatted(TODAY_START), childId);
		Counts accepted = new Counts(attemptsOk, answersOk, minutesOk);
		Counts rejected = new Counts(attempts.size() - attemptsOk, answers.size() - answersOk,
				minutes.size() - minutesOk);
		if (rejected.attempts() + rejected.answers() + rejected.minutes() > 0) {
			log.info("Sync skipped events childId={} attempts={} answers={} minutes={}", childId, rejected.attempts(),
					rejected.answers(), rejected.minutes());
		}
		return new Result(((Number) totals.get("stars_total")).intValue(), ((Number) totals.get("minutes")).intValue(),
				accepted, rejected);
	}

	private boolean saveAttempt(UUID familyId, UUID childId, Attempt a) {
		if (!KINDS.contains(a.kind())
				|| (a.completedAt() != null && a.completedAt().isBefore(a.startedAt()))
				|| (a.correctCount() != null && a.totalCount() != null && a.correctCount() > a.totalCount())) {
			return false;
		}
		UUID versionId = null;
		if (a.contentItemId() != null) {
			// RLS: only content the family may read; a version the family cannot see is not kept
			List<UUID> versions = jdbc.queryForList("""
					SELECT cv.id FROM app.content_items ci LEFT JOIN app.content_versions cv
					    ON cv.item_id = ci.id AND cv.id = ?
					 WHERE ci.id = ? AND ci.kind = 'lesson'""", UUID.class, a.contentVersionId(), a.contentItemId());
			if (versions.isEmpty()) {
				return false;
			}
			versionId = versions.get(0);
		}
		else if ("lesson".equals(a.kind())) {
			return false;
		}
		UUID chapterId = null;
		if (a.familyChapterId() != null) {
			Integer mine = jdbc.queryForObject("""
					SELECT count(*) FROM app.child_books cb
					  JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
					 WHERE cb.child_id = ? AND fc.id = ?""", Integer.class, childId, a.familyChapterId());
			if (mine == null || mine == 0) {
				return false;
			}
			chapterId = a.familyChapterId();
		}
		else if ("readalong".equals(a.kind())) {
			return false;
		}
		UUID topicId = a.topicId() == null ? null
				: jdbc.queryForList("SELECT id FROM app.topics WHERE id = ?", UUID.class, a.topicId())
					.stream()
					.findFirst()
					.orElse(null);
		int stars = a.completedAt() == null ? 0 : stars(a.correctCount(), a.totalCount());
		// Another child's attempt with the same id is left alone (the WHERE stops the update)
		int written = jdbc.update("""
				INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, content_item_id,
				    content_version_id, family_chapter_id, topic_id, started_at, completed_at, correct_count, total_count,
				    stars, duration_seconds, resume_state)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb))
				ON CONFLICT (id) DO UPDATE SET
				    completed_at = EXCLUDED.completed_at, correct_count = EXCLUDED.correct_count,
				    total_count = EXCLUDED.total_count, stars = EXCLUDED.stars,
				    duration_seconds = GREATEST(app.activity_attempts.duration_seconds, EXCLUDED.duration_seconds),
				    resume_state = EXCLUDED.resume_state, updated_at = now()
				  WHERE app.activity_attempts.child_id = EXCLUDED.child_id
				    AND (app.activity_attempts.completed_at IS NULL
				         OR (EXCLUDED.completed_at IS NOT NULL AND EXCLUDED.completed_at >= app.activity_attempts.completed_at))""",
				a.id(), familyId, childId, a.kind(), a.subjectId(), a.contentItemId(), versionId, chapterId, topicId,
				Timestamp.from(a.startedAt()), a.completedAt() == null ? null : Timestamp.from(a.completedAt()),
				a.correctCount(), a.totalCount(), stars, a.durationSeconds(),
				a.resumeState() == null || a.resumeState().isNull() ? null : JSON.writeValueAsString(a.resumeState()));
		// A stale or repeated event that changed nothing still reached the server
		return written == 1 || ownAttempt(childId, a.id());
	}

	private boolean saveAnswer(UUID familyId, UUID childId, Answer answer) {
		String json = JSON.writeValueAsString(answer.answer());
		if (json.length() > ANSWER_MAX_CHARS || !ownAttempt(childId, answer.attemptId())) {
			return false;
		}
		List<Map<String, Object>> question = jdbc.queryForList("""
				SELECT ci.topic_id FROM app.content_items ci
				  JOIN app.content_versions cv ON cv.item_id = ci.id AND cv.id = ?
				 WHERE ci.id = ? AND ci.kind = 'question'""", answer.questionVersionId(), answer.questionItemId());
		if (question.isEmpty()) {
			return false;
		}
		jdbc.update("""
				INSERT INTO app.answer_events (id, attempt_id, family_id, child_id, question_item_id, question_version_id,
				                               topic_id, is_correct, answer, answered_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)
				ON CONFLICT (id) DO NOTHING""", answer.id(), answer.attemptId(), familyId, childId,
				answer.questionItemId(), answer.questionVersionId(), question.get(0).get("topic_id"), answer.isCorrect(),
				json, Timestamp.from(answer.answeredAt()));
		return true;
	}

	private boolean ownAttempt(UUID childId, UUID attemptId) {
		Integer found = jdbc.queryForObject("SELECT count(*) FROM app.activity_attempts WHERE id = ? AND child_id = ?",
				Integer.class, attemptId, childId);
		return found != null && found > 0;
	}

}
