package com.fullstar.api.common.jobs;

import com.fullstar.api.common.resilience.Dependency;
import com.fullstar.api.common.resilience.ResilientCalls;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Sends jobs in the Schema §12 envelope. Inside a transaction the message is sent only after the
 * commit, so a worker never sees a job whose rows were rolled back.
 */
@Service
public class JobPublisher {

	private static final Logger log = LoggerFactory.getLogger(JobPublisher.class);

	private final software.amazon.awssdk.services.sqs.SqsClient sqs;

	private final QueueUrls queueUrls;

	private final JsonMapper json;

	private final ResilientCalls resilientCalls;

	public JobPublisher(software.amazon.awssdk.services.sqs.SqsClient sqs, QueueUrls queueUrls, JsonMapper json,
			ResilientCalls resilientCalls) {
		this.sqs = sqs;
		this.queueUrls = queueUrls;
		this.json = json;
		this.resilientCalls = resilientCalls;
	}

	/** Publishes (after commit if a transaction is active) and returns the envelope sent. */
	public JobEnvelope publish(JobQueue queue, String type, String idempotencyKey, Object payload) {
		JsonNode body = json.valueToTree(payload);
		JobEnvelope envelope = new JobEnvelope(UUID.randomUUID(), idempotencyKey, type, JobEnvelope.VERSION,
				Instant.now(), body);
		String message = json.writeValueAsString(envelope);
		if (TransactionSynchronizationManager.isSynchronizationActive()) {
			TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
				@Override
				public void afterCommit() {
					try {
						send(queue, envelope, message);
					}
					catch (RuntimeException ex) {
						// Already logged; the committed request must not turn into an error response
					}
				}
			});
		}
		else {
			send(queue, envelope, message);
		}
		return envelope;
	}

	private void send(JobQueue queue, JobEnvelope envelope, String message) {
		try {
			String url = queueUrls.of(queue);
			resilientCalls.call(Dependency.SQS,
					() -> sqs.sendMessage(request -> request.queueUrl(url).messageBody(message)));
		}
		catch (RuntimeException ex) {
			// After commit the request cannot roll back; the job id lets support re-send it.
			log.error("Could not publish job {} ({}) to {}", envelope.jobId(), envelope.type(), queue.baseName(), ex);
			throw ex;
		}
	}

}
