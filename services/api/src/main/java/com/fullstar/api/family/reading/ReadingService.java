package com.fullstar.api.family.reading;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.common.jobs.JobPublisher;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.storage.FileStorage;
import com.fullstar.api.common.storage.StorageKeys;
import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * K12–K14 reading test (Schema §4.4, §11, §12; App Flow §5; Plan 8.3, decided 22 Oct 2026).
 * Today's passage: English on even India days, Hindi on odd ones (the other language when the class
 * has none); within it, the passage at the child's level read least recently, else the closest
 * level. A retry the same day reads the same passage. The trigger allows 2 tests a day (429).
 */
@Service
public class ReadingService {

	private static final Logger log = LoggerFactory.getLogger(ReadingService.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	public static final String SCORE_JOB = "reading.score";

	static final int TESTS_PER_DAY = 2;

	/** Two minutes of speech in any browser codec stays well under this. */
	static final long MAX_RECORDING_BYTES = 10L * 1024 * 1024;

	static final String TODAY = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

	private final JdbcTemplate jdbc;

	private final FileStorage storage;

	private final JobPublisher jobs;

	public ReadingService(JdbcTemplate jdbc, FileStorage storage, JobPublisher jobs) {
		this.jdbc = jdbc;
		this.storage = storage;
		this.jobs = jobs;
	}

	public record Passage(UUID id, UUID versionId, String title, String lang, String text, int wordCount,
			int level) {
	}

	/** K12. lastResult is the newest scored test; its words are the ones to practise. */
	public record Home(Passage passage, int level, int testsLeftToday, boolean anyTests, Result lastResult) {
	}

	public record Result(UUID id, LocalDate testDate, BigDecimal accuracyPct, BigDecimal wordsPerMinute,
			List<String> wordsToPractise, int stars) {
	}

	public record Upload(String url, String method, Map<String, String> headers, Instant expiresAt) {
	}

	/** K13/K14: upload is set only while the recording is awaited. */
	public record Test(UUID id, String status, LocalDate testDate, UUID passageItemId, String title, String lang,
			BigDecimal accuracyPct, BigDecimal wordsPerMinute, Integer wordsRead, Integer wordCount,
			List<String> wordsToPractise, int stars, int testsLeftToday, int level, Upload upload) {
	}

	public Home home(UUID childId) {
		int level = level(childId);
		Integer today = jdbc.queryForObject(
				"SELECT count(*) FROM app.reading_tests WHERE child_id = ? AND test_date = " + TODAY, Integer.class,
				childId);
		Integer all = jdbc.queryForObject("SELECT count(*) FROM app.reading_tests WHERE child_id = ?", Integer.class,
				childId);
		List<Result> last = jdbc.query("""
				SELECT r.id, r.test_date, r.accuracy_pct, r.words_per_minute, r.words_to_practise, a.stars
				  FROM app.reading_tests r JOIN app.activity_attempts a ON a.id = r.attempt_id
				 WHERE r.child_id = ? AND r.status = 'scored' ORDER BY r.created_at DESC LIMIT 1""",
				(rs, n) -> new Result(rs.getObject("id", UUID.class), rs.getObject("test_date", LocalDate.class),
						rs.getBigDecimal("accuracy_pct"), rs.getBigDecimal("words_per_minute"),
						strings(rs.getArray("words_to_practise")), rs.getInt("stars")),
				childId);
		return new Home(todaysPassage(childId, level), level, Math.max(0, TESTS_PER_DAY - (today == null ? 0 : today)),
				all != null && all > 0, last.isEmpty() ? null : last.get(0));
	}

	/**
	 * K13 start: the device's ids (attempt and test), today's passage, and the recording's type and
	 * size; answers a PUT link for that exact file. The same id again gives a new link while waiting.
	 */
	public Test start(RequestActor actor, UUID childId, UUID id, UUID attemptId, UUID passageItemId,
			String contentType, long size) {
		List<Test> existing = find(childId, id);
		if (!existing.isEmpty()) {
			Test test = existing.get(0);
			return "awaiting_audio".equals(test.status()) ? withUpload(actor, test, contentType, size) : test;
		}
		Passage passage = todaysPassage(childId, level(childId));
		if (passage == null || !passage.id().equals(passageItemId)) {
			throw new ValidationException("passage_item_id is not today's passage",
					Map.of("passage_item_id", "INVALID"));
		}
		jdbc.update("""
				INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, content_item_id,
				                                   content_version_id, started_at)
				SELECT ?, ?, ?, 'reading_test', subject_id, id, published_version_id, now()
				  FROM app.content_items WHERE id = ?""", attemptId, actor.familyId(), childId, passage.id());
		// The trigger refuses a third test today: 429 READING_LIMIT
		jdbc.update("""
				INSERT INTO app.reading_tests (id, attempt_id, family_id, child_id, passage_item_id, passage_version_id,
				                               test_date, recording_key, recording_expires_at)
				VALUES (?, ?, ?, ?, ?, ?, %s, ?, now() + interval '7 days')""".formatted(TODAY), id, attemptId,
				actor.familyId(), childId, passage.id(), passage.versionId(), StorageKeys.recording(actor.familyId(), id));
		log.info("Reading test started readingTestId={} lang={}", id, passage.lang());
		return withUpload(actor, find(childId, id).get(0), contentType, size);
	}

	/** K13 done: the recording is stored, so scoring is queued. Calling it again changes nothing. */
	public Test submit(RequestActor actor, UUID childId, UUID id) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT r.status, r.recording_key, cv.body, ci.lang
				  FROM app.reading_tests r
				  JOIN app.content_items ci ON ci.id = r.passage_item_id
				  JOIN app.content_versions cv ON cv.id = r.passage_version_id
				 WHERE r.id = ? AND r.child_id = ? FOR UPDATE OF r""", id, childId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		if (!"awaiting_audio".equals(row.get("status"))) {
			return find(childId, id).get(0);
		}
		String key = (String) row.get("recording_key");
		long size = storage.size(key);
		if (size <= 0) {
			throw new ValidationException("The recording is not uploaded yet", Map.of("recording", "REQUIRED"));
		}
		if (size > MAX_RECORDING_BYTES) {
			throw new ApiException(ErrorCode.UPLOAD_LIMIT, "The recording is too large");
		}
		jdbc.update("UPDATE app.reading_tests SET status = 'processing' WHERE id = ?", id);
		JsonNode body = JSON.readTree(row.get("body").toString());
		jobs.publish(JobQueue.READING_SCORE, SCORE_JOB, SCORE_JOB + ":" + id,
				Map.of("reading_test_id", id.toString(), "family_id", actor.familyId().toString(), "recording_key", key,
						"passage_text", body.path("text").asString(), "lang", row.get("lang")));
		log.info("Reading test submitted readingTestId={} bytes={}", id, size);
		return find(childId, id).get(0);
	}

	/** K14 polls this every 2 seconds, for a minute at most. */
	public Test test(UUID childId, UUID id) {
		List<Test> found = find(childId, id);
		if (found.isEmpty()) {
			throw new NotFoundException();
		}
		return found.get(0);
	}

	/** P3: one row per test; recordingUrl plays the recording until it is deleted after 7 days. */
	public record HistoryEntry(UUID id, LocalDate testDate, String title, String lang, String status,
			BigDecimal accuracyPct, BigDecimal wordsPerMinute, List<String> wordsToPractise, int stars,
			String recordingUrl, Instant recordingExpiresAt) {
	}

	/** P3 reading history, newest first (the last 60 tests). Another family's child is not found. */
	public List<HistoryEntry> history(UUID childId) {
		level(childId);
		return jdbc.query("""
				SELECT r.id, r.test_date, cv.title, ci.lang, r.status, r.accuracy_pct, r.words_per_minute,
				       r.words_to_practise, a.stars, r.recording_key, r.recording_expires_at,
				       r.recording_key IS NOT NULL AND r.recording_expires_at > now()
				         AND r.status IN ('processing', 'scored', 'not_understood') AS playable
				  FROM app.reading_tests r
				  JOIN app.activity_attempts a ON a.id = r.attempt_id
				  JOIN app.content_items ci ON ci.id = r.passage_item_id
				  JOIN app.content_versions cv ON cv.id = r.passage_version_id
				 WHERE r.child_id = ? AND r.status <> 'awaiting_audio'
				 ORDER BY r.created_at DESC LIMIT 60""", (rs, n) -> {
			boolean playable = rs.getBoolean("playable");
			return new HistoryEntry(rs.getObject("id", UUID.class), rs.getObject("test_date", LocalDate.class),
					rs.getString("title"), rs.getString("lang"), rs.getString("status"), rs.getBigDecimal("accuracy_pct"),
					rs.getBigDecimal("words_per_minute"), strings(rs.getArray("words_to_practise")), rs.getInt("stars"),
					playable ? storage.signedGet(rs.getString("recording_key")).url().toString() : null,
					playable ? rs.getTimestamp("recording_expires_at").toInstant() : null);
		}, childId);
	}

	private Test withUpload(RequestActor actor, Test test, String contentType, long size) {
		FileStorage.SignedUrl signed = storage.signedPut(StorageKeys.recording(actor.familyId(), test.id()),
				contentType, size);
		Upload upload = new Upload(signed.url().toString(), signed.method(), Map.of("Content-Type", contentType),
				signed.expiresAt());
		return new Test(test.id(), test.status(), test.testDate(), test.passageItemId(), test.title(), test.lang(),
				test.accuracyPct(), test.wordsPerMinute(), test.wordsRead(), test.wordCount(), test.wordsToPractise(),
				test.stars(), test.testsLeftToday(), test.level(), upload);
	}

	private List<Test> find(UUID childId, UUID id) {
		return jdbc.query("""
				SELECT r.id, r.status, r.test_date, r.passage_item_id, cv.title, ci.lang, r.accuracy_pct,
				       r.words_per_minute, a.correct_count, a.total_count, r.words_to_practise, a.stars, c.reading_level,
				       (SELECT count(*) FROM app.reading_tests t WHERE t.child_id = r.child_id AND t.test_date = %s) AS today
				  FROM app.reading_tests r
				  JOIN app.activity_attempts a ON a.id = r.attempt_id
				  JOIN app.children c ON c.id = r.child_id
				  JOIN app.content_items ci ON ci.id = r.passage_item_id
				  JOIN app.content_versions cv ON cv.id = r.passage_version_id
				 WHERE r.id = ? AND r.child_id = ?""".formatted(TODAY), (rs, n) -> {
			boolean scored = "scored".equals(rs.getString("status"));
			return new Test(rs.getObject("id", UUID.class), rs.getString("status"),
					rs.getObject("test_date", LocalDate.class), rs.getObject("passage_item_id", UUID.class),
					rs.getString("title"), rs.getString("lang"), rs.getBigDecimal("accuracy_pct"),
					rs.getBigDecimal("words_per_minute"), scored ? rs.getInt("correct_count") : null,
					scored ? rs.getInt("total_count") : null, strings(rs.getArray("words_to_practise")),
					rs.getInt("stars"), Math.max(0, TESTS_PER_DAY - rs.getInt("today")), rs.getInt("reading_level"),
					null);
		}, id, childId);
	}

	private int level(UUID childId) {
		List<Integer> levels = jdbc.queryForList("SELECT reading_level FROM app.children WHERE id = ?", Integer.class,
				childId);
		if (levels.isEmpty()) {
			throw new NotFoundException();
		}
		return levels.get(0);
	}

	/** Today's test's passage if there is one; otherwise picked as the class comment says. */
	Passage todaysPassage(UUID childId, int level) {
		List<Passage> taken = jdbc.query("""
				SELECT ci.id, cv.id AS version_id, cv.title, ci.lang, cv.body
				  FROM app.reading_tests r
				  JOIN app.content_items ci ON ci.id = r.passage_item_id
				  JOIN app.content_versions cv ON cv.id = r.passage_version_id
				 WHERE r.child_id = ? AND r.test_date = %s ORDER BY r.created_at DESC LIMIT 1""".formatted(TODAY),
				ReadingService::passage, childId);
		if (!taken.isEmpty()) {
			return taken.get(0);
		}
		List<Passage> picked = jdbc.query("""
				SELECT ci.id, cv.id AS version_id, cv.title, ci.lang, cv.body
				  FROM app.content_items ci
				  JOIN app.content_versions cv ON cv.id = ci.published_version_id
				  JOIN app.children c ON c.id = ?
				 WHERE ci.kind = 'passage' AND ci.status = 'published' AND ci.class_level = c.class_level
				 ORDER BY (ci.lang = CASE WHEN (%s - DATE '2000-01-01') %% 2 = 0 THEN 'en' ELSE 'hi' END) DESC,
				          abs(COALESCE((cv.body->>'level')::int, 1) - ?), COALESCE((cv.body->>'level')::int, 1),
				          (SELECT max(t.created_at) FROM app.reading_tests t
				            WHERE t.child_id = c.id AND t.passage_item_id = ci.id) NULLS FIRST,
				          ci.created_at, ci.id
				 LIMIT 1""".formatted(TODAY), ReadingService::passage, childId, level);
		return picked.isEmpty() ? null : picked.get(0);
	}

	private static Passage passage(ResultSet rs, int n) throws SQLException {
		JsonNode body = JSON.readTree(rs.getString("body"));
		String text = body.path("text").asString();
		int words = body.path("word_count").asInt(0);
		return new Passage(rs.getObject("id", UUID.class), rs.getObject("version_id", UUID.class),
				rs.getString("title"), rs.getString("lang"), text,
				words > 0 ? words : text.strip().split("\\s+").length, body.path("level").asInt(1));
	}

	static List<String> strings(Array array) throws SQLException {
		return array == null ? List.of() : Arrays.asList((String[]) array.getArray());
	}

}
