package com.fullstar.api.studio.check;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.common.jobs.JobEnvelope;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.JobResultsConsumer;
import com.fullstar.api.common.jobs.QueueUrls;
import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.StudioTestSupport;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import software.amazon.awssdk.services.sqs.SqsClient;
import tools.jackson.databind.JsonNode;

/** Plan 8.2: publishing a lesson queues lesson-narrate; the result gives the version its MP3 and scene times. */
class LessonNarrationTest extends StudioTestSupport {

	private static final String ALL_TRUE = """
			{ "age_suitability": true, "facts_match": true, "answers_correct": true, "language": true,
			  "difficulty": true, "no_bias": true, "no_personal_info": true }""";

	@Autowired
	private SqsClient sqs;

	@Autowired
	private QueueUrls queueUrls;

	@Autowired
	private JobResultsConsumer consumer;

	private UUID topicId;

	@BeforeEach
	void setUp() {
		asStaff("content_admin");
		topicId = newTopic("evs");
		// Other tests publish lessons too; start from an empty lesson-narrate queue
		sqs.purgeQueue(r -> r.queueUrl(queueUrls.of(JobQueue.LESSON_NARRATE)));
	}

	/** A checked, published lesson; returns [item id, version id]. */
	private String[] publishedLesson(String lang) throws Exception {
		JsonNode created = data(send(post("/api/v1/studio/content-items"), """
				{ "kind": "lesson", "class_level": 3, "subject": "evs", "topic_id": "%s", "lang": "%s",
				  "title": "Nests", "body": %s }""".formatted(topicId, lang, ContentSamples.LESSON))
			.andExpect(status().isCreated())
			.andReturn());
		String itemId = created.path("item").path("id").asString();
		String versionId = created.path("current_version").path("id").asString();
		send(post("/api/v1/studio/content-versions/" + versionId + "/manual-check"),
				"{ \"checklist\": " + ALL_TRUE + ", \"flags\": [] }")
			.andExpect(status().isCreated());
		send(post("/api/v1/studio/content-items/" + itemId + "/publish"), "").andExpect(status().isOk());
		return new String[] { itemId, versionId };
	}

	/** The lesson-narrate job for this version, taken off the queue; null if none comes. */
	private JsonNode narrateJob(String versionId) throws InterruptedException {
		String url = queueUrls.of(JobQueue.LESSON_NARRATE);
		Instant until = Instant.now().plus(Duration.ofSeconds(5));
		while (Instant.now().isBefore(until)) {
			JsonNode found = null;
			for (var message : sqs.receiveMessage(r -> r.queueUrl(url).maxNumberOfMessages(10).waitTimeSeconds(1))
				.messages()) {
				JsonNode envelope = JSON.readTree(message.body());
				if (found == null && envelope.path("payload").path("content_version_id").asString().equals(versionId)) {
					sqs.deleteMessage(r -> r.queueUrl(url).receiptHandle(message.receiptHandle()));
					found = envelope;
				}
				else {
					sqs.changeMessageVisibility(
							r -> r.queueUrl(url).receiptHandle(message.receiptHandle()).visibilityTimeout(0));
				}
			}
			if (found != null) {
				return found;
			}
		}
		return null;
	}

	/** The worker's result, applied as the job-results consumer applies it (the queue path is JobFlowTest's). */
	private void report(JsonNode job, String outcome, Object result) {
		String key = job.path("idempotency_key").asString();
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("job_id", job.path("job_id").asString());
		payload.put("idempotency_key", key);
		payload.put("type", "lesson.narrate");
		payload.put("outcome", outcome);
		payload.put("result", result);
		payload.put("error", "failure".equals(outcome) ? Map.of("code", "WORKER_FAILED") : null);
		String body = JSON.writeValueAsString(
				new JobEnvelope(UUID.randomUUID(), key, "job.result", 1, Instant.now(), JSON.valueToTree(payload)));
		consumer.process(body);
	}

	private String audioKey(String versionId) {
		return systemQuery("SELECT coalesce(narration_audio_key, '') FROM app.content_versions WHERE id = ?",
				UUID.fromString(versionId));
	}

	@Test
	void aPublishedLessonIsNarratedOnceAndTheVersionKeepsItsText() throws Exception {
		String[] lesson = publishedLesson("hi");
		JsonNode job = narrateJob(lesson[1]);
		assertThat(job).isNotNull();
		assertThat(job.path("type").asString()).isEqualTo("lesson.narrate");
		assertThat(job.path("idempotency_key").asString()).startsWith("lesson.narrate:" + lesson[1] + ":");
		JsonNode payload = job.path("payload");
		assertThat(payload.path("item_id").asString()).isEqualTo(lesson[0]);
		assertThat(payload.path("version_no").asInt()).isEqualTo(1);
		assertThat(payload.path("scenes").size()).isEqualTo(2);
		assertThat(payload.path("scenes").path(0).path("id").asString()).isEqualTo("s1");
		assertThat(payload.path("scenes").path(0).path("text").asString()).isEqualTo("A bird builds a nest.");
		assertThat(payload.path("scenes").path(1).path("lang").asString()).isEqualTo("hi");

		String key = "content/" + lesson[0] + "/1/narration.mp3";
		report(job, "success", Map.of("audio_key", key, "scenes",
				List.of(Map.of("id", "s1", "start_ms", 300, "end_ms", 2100),
						Map.of("id", "s2", "start_ms", 2700, "end_ms", 4800))));
		assertThat(audioKey(lesson[1])).isEqualTo(key);
		Integer scenes = systemQuery("SELECT jsonb_array_length(narration_timings) FROM app.content_versions WHERE id = ?",
				UUID.fromString(lesson[1]));
		assertThat(scenes).isEqualTo(2);

		// The text of a saved version still can't change (VERSION_IMMUTABLE), only its narration
		assertThatThrownBy(() -> systemQuery(
				"UPDATE app.content_versions SET title = 'Changed' WHERE id = ? RETURNING id", UUID.fromString(lesson[1])))
			.hasMessageContaining("VERSION_IMMUTABLE");

		// Publishing again does not narrate a version twice
		send(post("/api/v1/studio/content-items/" + lesson[0] + "/publish"), "").andExpect(status().isOk());
		assertThat(narrateJob(lesson[1])).isNull();
	}

	@Test
	void aFailedOrForeignResultLeavesTheLessonOnTheDeviceVoice() throws Exception {
		String[] lesson = publishedLesson("en");
		JsonNode failed = narrateJob(lesson[1]);
		report(failed, "failure", null);
		// A result naming another version's file is never applied (it would go to the DLQ)
		String[] other = publishedLesson("en");
		JsonNode job = narrateJob(other[1]);
		assertThatThrownBy(() -> report(job, "success", Map.of("audio_key", "content/" + lesson[0] + "/1/narration.mp3",
				"scenes", List.of(Map.of("id", "s1", "start_ms", 0, "end_ms", 10)))))
			.isInstanceOf(IllegalStateException.class);
		assertThat(audioKey(lesson[1])).isEmpty();
		assertThat(audioKey(other[1])).isEmpty();

		// After a failure, publishing again narrates again (a new run key)
		send(post("/api/v1/studio/content-items/" + lesson[0] + "/publish"), "").andExpect(status().isOk());
		JsonNode again = narrateJob(lesson[1]);
		assertThat(again).isNotNull();
		assertThat(again.path("idempotency_key").asString()).isNotEqualTo(failed.path("idempotency_key").asString());
	}

}
