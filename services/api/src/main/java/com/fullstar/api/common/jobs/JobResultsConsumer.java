package com.fullstar.api.common.jobs;

import com.fullstar.api.common.db.DataSourceConfig;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.SmartLifecycle;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import tools.jackson.databind.json.JsonMapper;

/**
 * The job-results consumer (Schema §1 rule 2, §12): long-polls job-results and applies each worker
 * result once, as app_system. The original job's idempotency_key is inserted into processed_jobs in
 * the same transaction as the handler's changes: a duplicate is skipped and deleted; a failure
 * leaves the message on the queue, so after 3 receives it moves to job-results-dlq.
 */
@Component
@ConditionalOnProperty(name = "fullstar.queues.consumer-enabled", havingValue = "true")
public class JobResultsConsumer implements SmartLifecycle {

	private static final Logger log = LoggerFactory.getLogger(JobResultsConsumer.class);

	/**
	 * Job keys share processed_jobs with client Idempotency-Keys (UUIDs, job_type 'http'); the prefix
	 * keeps them apart, so a client can never pre-claim a job's key and make its result look like a
	 * duplicate.
	 */
	static final String JOB_KEY_PREFIX = "job:";

	private final SqsClient sqs;

	private final QueueUrls queueUrls;

	private final QueueProperties properties;

	private final JsonMapper json;

	private final JdbcTemplate system;

	private final TransactionTemplate systemTransactions;

	private final Map<String, JobResultHandler> handlers;

	private volatile boolean running;

	private Thread worker;

	public JobResultsConsumer(SqsClient sqs, QueueUrls queueUrls, QueueProperties properties, JsonMapper json,
			@Qualifier(DataSourceConfig.SYSTEM) JdbcTemplate system,
			@Qualifier(DataSourceConfig.SYSTEM) TransactionTemplate systemTransactions, List<JobResultHandler> handlers) {
		this.sqs = sqs;
		this.queueUrls = queueUrls;
		this.properties = properties;
		this.json = json;
		this.system = system;
		this.systemTransactions = systemTransactions;
		this.handlers = handlers.stream().collect(Collectors.toUnmodifiableMap(JobResultHandler::type, Function.identity()));
	}

	public enum Outcome {

		APPLIED, DUPLICATE

	}

	/** Applies one message body; throws if it cannot be applied (the message then stays on the queue). */
	public Outcome process(String body) {
		JobEnvelope envelope = json.readValue(body, JobEnvelope.class);
		JobResult result = json.treeToValue(envelope.payload(), JobResult.class);
		if (result.idempotencyKey() == null || result.type() == null) {
			throw new IllegalArgumentException("job result without idempotency_key or type");
		}
		JobResultHandler handler = handlers.get(result.type());
		if (handler == null) {
			throw new IllegalArgumentException("no handler for job type " + result.type());
		}
		return systemTransactions.execute(status -> {
			int claimed = system.update("""
					INSERT INTO app.processed_jobs (idempotency_key, job_type) VALUES (?, ?)
					ON CONFLICT (idempotency_key) DO NOTHING""", JOB_KEY_PREFIX + result.idempotencyKey(), result.type());
			if (claimed == 0) {
				return Outcome.DUPLICATE;
			}
			handler.apply(result, system);
			return Outcome.APPLIED;
		});
	}

	private void pollLoop() {
		while (running) {
			try {
				String url = queueUrls.of(JobQueue.JOB_RESULTS);
				List<Message> messages = sqs.receiveMessage(request -> request.queueUrl(url)
					.maxNumberOfMessages(10)
					.waitTimeSeconds(properties.waitSeconds())).messages();
				for (Message message : messages) {
					handle(url, message);
				}
			}
			catch (RuntimeException ex) {
				if (running) {
					log.warn("job-results poll failed: {}", ex.getClass().getSimpleName());
					sleep(5_000);
				}
			}
		}
	}

	private void handle(String url, Message message) {
		try {
			Outcome outcome = process(message.body());
			sqs.deleteMessage(request -> request.queueUrl(url).receiptHandle(message.receiptHandle()));
			log.atInfo().addKeyValue("message_id", message.messageId()).addKeyValue("outcome", outcome).log("job result");
		}
		catch (RuntimeException ex) {
			// Not deleted: retried after the visibility timeout, then moved to job-results-dlq
			log.warn("job result {} not applied: {}", message.messageId(), ex.getClass().getSimpleName());
		}
	}

	@Override
	public void start() {
		running = true;
		worker = Thread.ofVirtual().name("job-results-consumer").start(this::pollLoop);
	}

	@Override
	public void stop() {
		running = false;
		if (worker != null) {
			worker.interrupt();
		}
	}

	@Override
	public boolean isRunning() {
		return running;
	}

	private static void sleep(long millis) {
		try {
			Thread.sleep(millis);
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
		}
	}

}
