package com.fullstar.api.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fullstar.api.common.jobs.JobEnvelope;
import com.fullstar.api.common.jobs.JobPublisher;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.JobResultsConsumer;
import com.fullstar.api.common.jobs.QueueUrls;
import com.fullstar.api.testsupport.ApiTestSupport;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import tools.jackson.databind.json.JsonMapper;

/**
 * Plan 1.6 integration test: publish → a fake worker takes the job and reports to job-results →
 * the consumer applies it once and ignores a duplicate.
 */
class JobFlowTest extends ApiTestSupport {

	@Autowired
	private JobPublisher publisher;

	@Autowired
	private SqsClient sqs;

	@Autowired
	private QueueUrls queueUrls;

	@Autowired
	private JsonMapper json;

	@Autowired
	private TransactionTemplate transactions;

	@Autowired
	private JobResultsConsumer consumer;

	@Test
	void publishedJobIsSentOnlyAfterCommitInTheEnvelope() {
		String key = "book.process:" + UUID.randomUUID();
		String url = queueUrls.of(JobQueue.BOOK_PROCESS);
		drain(url);

		transactions.executeWithoutResult(status -> {
			publisher.publish(JobQueue.BOOK_PROCESS, "book.process", key, Map.of("upload_id", "u-1", "mode", "whole"));
			assertThat(receive(url, 0)).as("not sent before commit").isEmpty();
		});
		List<Message> sent = receive(url, 2);
		assertThat(sent).hasSize(1);
		JobEnvelope envelope = json.readValue(sent.get(0).body(), JobEnvelope.class);
		assertThat(envelope.type()).isEqualTo("book.process");
		assertThat(envelope.idempotencyKey()).isEqualTo(key);
		assertThat(envelope.version()).isEqualTo(1);
		assertThat(envelope.payload().path("upload_id").asString()).isEqualTo("u-1");
		assertThat(sent.get(0).body()).contains("\"job_id\"", "\"idempotency_key\"", "\"created_at\"");
	}

	@Test
	void rolledBackJobIsNeverSent() {
		String url = queueUrls.of(JobQueue.WORKSHEET_RENDER);
		drain(url);
		transactions.executeWithoutResult(status -> {
			publisher.publish(JobQueue.WORKSHEET_RENDER, "worksheet.render", "k-" + UUID.randomUUID(), Map.of());
			status.setRollbackOnly();
		});
		assertThat(receive(url, 1)).isEmpty();
	}

	@Test
	void workerResultIsAppliedOnceAndTheDuplicateIgnored() {
		// The API publishes a job; a fake worker takes it and reports the result
		String jobKey = "test.echo:" + UUID.randomUUID();
		String tag = "echo-" + UUID.randomUUID();
		String jobsUrl = queueUrls.of(JobQueue.READING_SCORE);
		drain(jobsUrl);
		JobEnvelope job = publisher.publish(JobQueue.READING_SCORE, "test.echo", jobKey, Map.of("tag", tag));
		Message taken = receive(jobsUrl, 2).get(0);
		sqs.deleteMessage(r -> r.queueUrl(jobsUrl).receiptHandle(taken.receiptHandle()));

		String result = workerResult(job, tag);
		String resultsUrl = queueUrls.of(JobQueue.JOB_RESULTS);
		sqs.sendMessage(r -> r.queueUrl(resultsUrl).messageBody(result));
		await(() -> appliedCount(tag) == 1, "result applied");

		// Same job reported again (a worker retry)
		sqs.sendMessage(r -> r.queueUrl(resultsUrl).messageBody(result));
		await(() -> queueEmpty(resultsUrl), "duplicate consumed");
		assertThat(appliedCount(tag)).isEqualTo(1);
		Long processed = systemQuery("SELECT count(*) FROM app.processed_jobs WHERE idempotency_key = ?", "job:" + jobKey);
		assertThat(processed).isEqualTo(1);
	}

	@Test
	void resultWithoutAHandlerIsNotAppliedSoItEndsInTheDeadLetterQueue() {
		String body = json.writeValueAsString(new JobEnvelope(UUID.randomUUID(), "k-" + UUID.randomUUID(), "job.result", 1,
				Instant.now(), json.valueToTree(Map.of("job_id", UUID.randomUUID().toString(), "idempotency_key",
						"k-" + UUID.randomUUID(), "type", "no.such.type", "outcome", "success"))));
		assertThatThrownBy(() -> consumer.process(body)).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> consumer.process("{not json")).isInstanceOf(RuntimeException.class);
	}

	private String workerResult(JobEnvelope job, String tag) {
		Map<String, Object> payload = Map.of("job_id", job.jobId().toString(), "idempotency_key", job.idempotencyKey(),
				"type", job.type(), "outcome", "success", "result", Map.of("tag", tag));
		return json.writeValueAsString(new JobEnvelope(UUID.randomUUID(), job.idempotencyKey(), "job.result", 1,
				Instant.now(), json.valueToTree(payload)));
	}

	private static long appliedCount(String tag) {
		Long count = systemQuery("SELECT count(*) FROM app.audit_log WHERE action = 'test.echo' AND entity_id = ?", tag);
		return count;
	}

	private boolean queueEmpty(String url) {
		Map<QueueAttributeName, String> attributes = sqs.getQueueAttributes(r -> r.queueUrl(url)
			.attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES,
					QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES_NOT_VISIBLE))
			.attributes();
		return "0".equals(attributes.get(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES))
				&& "0".equals(attributes.get(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES_NOT_VISIBLE));
	}

	private List<Message> receive(String url, int waitSeconds) {
		return sqs.receiveMessage(r -> r.queueUrl(url).maxNumberOfMessages(10).waitTimeSeconds(waitSeconds)).messages();
	}

	private void drain(String url) {
		sqs.purgeQueue(r -> r.queueUrl(url));
	}

	private static void await(BooleanSupplier condition, String what) {
		Instant deadline = Instant.now().plus(Duration.ofSeconds(20));
		while (Instant.now().isBefore(deadline)) {
			if (condition.getAsBoolean()) {
				return;
			}
			try {
				Thread.sleep(200);
			}
			catch (InterruptedException ex) {
				Thread.currentThread().interrupt();
				throw new IllegalStateException(ex);
			}
		}
		throw new AssertionError("Timed out waiting for: " + what);
	}

}
