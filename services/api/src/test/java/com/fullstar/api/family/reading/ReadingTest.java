package com.fullstar.api.family.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.common.jobs.JobEnvelope;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.QueueUrls;
import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Plan 8.3: today's passage (language by India day, then level), the recording upload, a queued
 * reading.score job, results applied once (stars, level up, not understood), 2 tests a day (429),
 * and P3 history for this family only.
 */
class ReadingTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final HttpClient HTTP = HttpClient.newHttpClient();

	private static final byte[] AUDIO = { 0x1A, 0x45, (byte) 0xDF, (byte) 0xA3, 1, 2, 3, 4 };

	@Autowired
	private SqsClient sqs;

	@Autowired
	private QueueUrls queueUrls;

	private String bearer;

	private String grant;

	private UUID familyId;

	private UUID childId;

	private int classLevel;

	private String todaysLang;

	private UUID todaysLevel1;

	@BeforeEach
	void family() throws Exception {
		String subject = UUID.randomUUID().toString();
		bearer = TestTokens.token().subject(subject).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		MvcResult pin = mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andExpect(status().isCreated()).andReturn();
		grant = JSON.readTree(pin.getResponse().getContentAsString()).path("data").path("parent_grant").asString();
		familyId = systemQuery("SELECT id FROM app.families WHERE keycloak_user_id = ?", subject);
		// A class of its own, so other tests' passages don't count
		classLevel = 5;
		childId = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Asha', 10, ?, 'cat') RETURNING id""", familyId, classLevel);
		systemQuery("""
				WITH old AS (UPDATE app.content_items SET status = 'archived'
				              WHERE kind = 'passage' AND class_level = ? AND status = 'published' RETURNING 1)
				SELECT count(*) FROM old""", classLevel);
		Boolean even = systemQuery(
				"SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - DATE '2000-01-01') % 2 = 0");
		todaysLang = even ? "en" : "hi";
		String other = even ? "hi" : "en";
		todaysLevel1 = passage(todaysLang, 1, "The sun is hot today and we play in the park.");
		passage(todaysLang, 2, "A harder story about rivers and mountains far away.");
		passage(other, 1, "Not today's language.");
	}

	private UUID passage(String lang, int level, String text) {
		UUID staff = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', 'content_admin') RETURNING id""", UUID.randomUUID().toString());
		UUID topic = systemQuery("INSERT INTO app.topics (class_level, subject_id, name) VALUES (?, ?, ?) RETURNING id",
				classLevel, "en".equals(lang) ? 1 : 2, "Reading " + UUID.randomUUID());
		UUID item = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, lang, created_by)
				VALUES ('passage', 'library', ?, ?, ?, ?, ?) RETURNING id""", classLevel, "en".equals(lang) ? 1 : 2, topic,
				lang, staff);
		UUID version = systemQuery("""
				INSERT INTO app.content_versions (item_id, version_no, title, body, created_by)
				VALUES (?, 1, ?, CAST(? AS jsonb), ?) RETURNING id""", item, "Passage " + level + lang,
				JSON.writeValueAsString(Map.of("text", text, "word_count", text.split(" ").length, "level", level)), staff);
		systemQuery("INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual') RETURNING id",
				version);
		systemQuery("""
				UPDATE app.content_items SET current_version_id = ?, published_version_id = ?, status = 'published',
				       published_at = now() WHERE id = ? RETURNING id""", version, version, item);
		return item;
	}

	private ResultActions kid(MockHttpServletRequestBuilder request) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer).header("X-Child-Id", childId.toString()));
	}

	private ResultActions start(UUID id, UUID passageId) throws Exception {
		return kid(post("/api/v1/family/kid/reading-tests").contentType(MediaType.APPLICATION_JSON).content("""
				{ "id": "%s", "attempt_id": "%s", "passage_item_id": "%s", "content_type": "audio/webm", "size": %d }"""
			.formatted(id, UUID.randomUUID(), passageId, AUDIO.length)));
	}

	private static JsonNode data(ResultActions result) throws Exception {
		return JSON.readTree(result.andReturn().getResponse().getContentAsString()).path("data");
	}

	/** Starts, uploads and submits a test; answers its id. */
	private UUID record() throws Exception {
		return record(todaysLevel1);
	}

	private UUID record(UUID passageId) throws Exception {
		UUID id = UUID.randomUUID();
		JsonNode started = data(start(id, passageId).andExpect(status().isCreated()));
		HttpRequest put = HttpRequest.newBuilder(URI.create(started.path("upload").path("url").asString()))
			.header("Content-Type", "audio/webm")
			.PUT(HttpRequest.BodyPublishers.ofByteArray(AUDIO))
			.build();
		assertThat(HTTP.send(put, HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);
		kid(post("/api/v1/family/kid/reading-tests/" + id + "/submit")).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("processing"));
		return id;
	}

	/** What reading-checker sends to job-results (Schema §12). */
	private void report(UUID testId, String outcome, Map<String, Object> result) {
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("job_id", UUID.randomUUID().toString());
		payload.put("idempotency_key", "reading.score:" + testId);
		payload.put("type", "reading.score");
		payload.put("outcome", outcome);
		payload.put("result", result);
		payload.put("error", "failure".equals(outcome) ? Map.of("code", "WORKER_FAILED") : null);
		String body = JSON.writeValueAsString(new JobEnvelope(UUID.randomUUID(), "reading.score:" + testId,
				"job.result", 1, Instant.now(), JSON.valueToTree(payload)));
		String url = queueUrls.of(JobQueue.JOB_RESULTS);
		sqs.sendMessage(r -> r.queueUrl(url).messageBody(body));
	}

	private static Map<String, Object> scored(double accuracy) {
		return Map.of("outcome", "scored", "transcript", "the sun is hot", "accuracy_pct", accuracy,
				"words_per_minute", 84.5, "words_read", 9, "word_count", 11, "words_to_practise",
				List.of("park", "today"));
	}

	private String statusOf(UUID testId) {
		return systemQuery("SELECT status FROM app.reading_tests WHERE id = ?", testId);
	}

	private static void await(BooleanSupplier condition, String what) throws InterruptedException {
		Instant until = Instant.now().plus(Duration.ofSeconds(20));
		while (!condition.getAsBoolean()) {
			if (Instant.now().isAfter(until)) {
				throw new AssertionError("timed out: " + what);
			}
			Thread.sleep(200);
		}
	}

	@Test
	void todaysPassageIsInTodaysLanguageAtTheChildsLevel() throws Exception {
		kid(get("/api/v1/family/kid/reading")).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.passage.id").value(todaysLevel1.toString()))
			.andExpect(jsonPath("$.data.passage.lang").value(todaysLang))
			.andExpect(jsonPath("$.data.passage.level").value(1))
			.andExpect(jsonPath("$.data.passage.word_count").value(11))
			.andExpect(jsonPath("$.data.level").value(1))
			.andExpect(jsonPath("$.data.tests_left_today").value(2))
			.andExpect(jsonPath("$.data.any_tests").value(false))
			.andExpect(jsonPath("$.data.last_result").doesNotExist());

		// Only today's passage can be read
		UUID harder = systemQuery("""
				SELECT ci.id FROM app.content_items ci JOIN app.content_versions cv ON cv.id = ci.published_version_id
				 WHERE ci.class_level = ? AND ci.lang = ? AND cv.body->>'level' = '2'""", classLevel, todaysLang);
		start(UUID.randomUUID(), harder).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.passage_item_id").value("INVALID"));
	}

	@Test
	void aRecordingIsQueuedForScoringAndTheScoreGivesStars() throws Exception {
		UUID early = UUID.randomUUID();
		start(early, todaysLevel1).andExpect(status().isCreated());
		kid(post("/api/v1/family/kid/reading-tests/" + early + "/submit")).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.recording").value("REQUIRED"));

		UUID testId = UUID.randomUUID();
		// The first test was never recorded but still counts: 1 left after this one
		JsonNode started = data(start(testId, todaysLevel1).andExpect(status().isCreated()));
		assertThat(started.path("status").asString()).isEqualTo("awaiting_audio");
		assertThat(started.path("upload").path("method").asString()).isEqualTo("PUT");
		assertThat(started.path("tests_left_today").asInt()).isZero();
		HttpRequest put = HttpRequest.newBuilder(URI.create(started.path("upload").path("url").asString()))
			.header("Content-Type", "audio/webm")
			.PUT(HttpRequest.BodyPublishers.ofByteArray(AUDIO))
			.build();
		assertThat(HTTP.send(put, HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);
		kid(post("/api/v1/family/kid/reading-tests/" + testId + "/submit")).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("processing"));
		// Submitting again changes nothing
		kid(post("/api/v1/family/kid/reading-tests/" + testId + "/submit")).andExpect(status().isOk());

		String url = queueUrls.of(JobQueue.READING_SCORE);
		List<Message> messages = sqs.receiveMessage(r -> r.queueUrl(url).maxNumberOfMessages(10).waitTimeSeconds(5))
			.messages();
		assertThat(messages).anySatisfy(message -> {
			JsonNode envelope = JSON.readTree(message.body());
			assertThat(envelope.path("type").asString()).isEqualTo("reading.score");
			assertThat(envelope.path("idempotency_key").asString()).isEqualTo("reading.score:" + testId);
			JsonNode payload = envelope.path("payload");
			assertThat(payload.path("reading_test_id").asString()).isEqualTo(testId.toString());
			assertThat(payload.path("family_id").asString()).isEqualTo(familyId.toString());
			assertThat(payload.path("recording_key").asString())
				.isEqualTo("families/" + familyId + "/recordings/" + testId + ".webm");
			assertThat(payload.path("passage_text").asString()).startsWith("The sun is hot");
			assertThat(payload.path("lang").asString()).isEqualTo(todaysLang);
		});

		report(testId, "success", scored(81.82));
		await(() -> "scored".equals(statusOf(testId)), "scored");
		kid(get("/api/v1/family/kid/reading-tests/" + testId)).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("scored"))
			.andExpect(jsonPath("$.data.accuracy_pct").value(81.82))
			.andExpect(jsonPath("$.data.words_per_minute").value(84.5))
			.andExpect(jsonPath("$.data.words_read").value(9))
			.andExpect(jsonPath("$.data.word_count").value(11))
			.andExpect(jsonPath("$.data.words_to_practise[0]").value("park"))
			.andExpect(jsonPath("$.data.stars").value(3));
		Integer stars = systemQuery("SELECT stars_total FROM app.children WHERE id = ?", childId);
		assertThat(stars).isEqualTo(3);
		kid(get("/api/v1/family/kid/reading")).andExpect(jsonPath("$.data.tests_left_today").value(0))
			.andExpect(jsonPath("$.data.any_tests").value(true))
			.andExpect(jsonPath("$.data.last_result.words_to_practise[1]").value("today"));

		// A result applied twice changes nothing; a third test today is refused
		report(testId, "success", scored(40));
		Thread.sleep(1500);
		assertThat(stars).isEqualTo((Integer) systemQuery("SELECT stars_total FROM app.children WHERE id = ?", childId));
		start(UUID.randomUUID(), todaysLevel1).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.error.code").value("READING_LIMIT"));
	}

	@Test
	void notUnderstoodGivesNoScoreAndTwoStrongTestsMoveTheLevelUp() throws Exception {
		UUID unclear = record();
		report(unclear, "success", Map.of("outcome", "not_understood", "transcript", "mm", "words_read", 0,
				"word_count", 11, "words_to_practise", List.of()));
		await(() -> "not_understood".equals(statusOf(unclear)), "not understood");
		kid(get("/api/v1/family/kid/reading-tests/" + unclear)).andExpect(jsonPath("$.data.accuracy_pct").doesNotExist())
			.andExpect(jsonPath("$.data.stars").value(0));

		// Two strong tests at level 1 (on two days: the limit is 2 a day)
		UUID first = record();
		report(first, "success", scored(95));
		await(() -> "scored".equals(statusOf(first)), "first scored");
		systemQuery("UPDATE app.reading_tests SET test_date = test_date - 1 WHERE child_id = ? RETURNING id", childId);
		UUID second = record();
		report(second, "success", scored(92));
		await(() -> "scored".equals(statusOf(second)), "second scored");
		Integer level = systemQuery("SELECT reading_level FROM app.children WHERE id = ?", childId);
		assertThat(level).isEqualTo(2);

		// Level 2 now reads the harder passage; a failed job says so and nothing is scored
		systemQuery("UPDATE app.reading_tests SET test_date = test_date - 1 WHERE child_id = ? RETURNING id", childId);
		JsonNode home = data(kid(get("/api/v1/family/kid/reading")));
		assertThat(home.path("level").asInt()).isEqualTo(2);
		assertThat(home.path("passage").path("level").asInt()).isEqualTo(2);
		UUID broken = record(UUID.fromString(home.path("passage").path("id").asString()));
		report(broken, "failure", null);
		await(() -> "failed".equals(statusOf(broken)), "failed");
	}

	@Test
	void parentsSeeTheHistoryWithRecordingsOfTheirOwnChildOnly() throws Exception {
		UUID testId = record();
		report(testId, "success", scored(70));
		await(() -> "scored".equals(statusOf(testId)), "scored");
		mvc.perform(get("/api/v1/family/parent/children/" + childId + "/reading-tests")
			.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.length()").value(1))
			.andExpect(jsonPath("$.data[0].status").value("scored"))
			.andExpect(jsonPath("$.data[0].stars").value(2))
			.andExpect(jsonPath("$.data[0].recording_url").isString())
			.andExpect(jsonPath("$.data[0].recording_expires_at").isString());

		// After 7 days the recording can't be played
		systemQuery("UPDATE app.reading_tests SET recording_expires_at = now() - interval '1 minute' WHERE id = ? RETURNING id",
				testId);
		mvc.perform(get("/api/v1/family/parent/children/" + childId + "/reading-tests")
			.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)).andExpect(jsonPath("$.data[0].recording_url").doesNotExist());

		UUID other = newFamily();
		UUID otherChild = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Ravi', 8, 3, 'lion') RETURNING id""", other);
		mvc.perform(get("/api/v1/family/parent/children/" + otherChild + "/reading-tests")
			.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)).andExpect(status().isNotFound());
	}

}
