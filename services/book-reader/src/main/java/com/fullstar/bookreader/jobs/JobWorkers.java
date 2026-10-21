package com.fullstar.bookreader.jobs;

import com.fullstar.bookreader.config.ReaderProperties;
import com.fullstar.bookreader.resilience.ResilientCalls;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.MessageSystemAttributeName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Runs every {@link JobHandler} on its queue (Schema §12): long-polls, does the job and sends the
 * result to job-results, then deletes the message. A failed job stays on the queue (visibility
 * timeout, max 3 receives, then &lt;queue&gt;-dlq); on its last receive a failure result is sent so
 * the API can tell the parent. Sending a result twice is harmless: the API applies each job once.
 */
@Component
public class JobWorkers implements SmartLifecycle {

	private static final Logger log = LoggerFactory.getLogger(JobWorkers.class);

	public static final String RESULTS_QUEUE = "job-results";

	public static final int MAX_RECEIVES = 3;

	private final SqsClient sqs;

	private final ReaderProperties.Queues queues;

	private final JsonMapper json;

	private final ResilientCalls calls;

	private final List<JobHandler> handlers;

	private final Map<String, String> urls = new ConcurrentHashMap<>();

	private final List<Thread> threads = new ArrayList<>();

	private volatile boolean running;

	public JobWorkers(SqsClient sqs, ReaderProperties properties, JsonMapper json, ResilientCalls calls,
			List<JobHandler> handlers) {
		this.sqs = sqs;
		this.queues = properties.queues();
		this.json = json;
		this.calls = calls;
		this.handlers = handlers;
	}

	public enum Outcome {

		SUCCESS, RETRY, FAILURE

	}

	/** Does one message: the result is sent (success, or failure on the last receive) or it is left to retry. */
	public Outcome process(JobHandler handler, String body, int receiveCount) {
		JobEnvelope job = json.readValue(body, JobEnvelope.class);
		if (!handler.type().equals(job.type())) {
			throw new IllegalArgumentException("Unexpected job type " + job.type() + " on " + handler.queue());
		}
		try {
			JsonNode result = handler.handle(job);
			sendResult(job, "success", result, null);
			return Outcome.SUCCESS;
		}
		catch (RuntimeException ex) {
			log.atWarn()
				.addKeyValue("job_id", job.jobId())
				.addKeyValue("type", job.type())
				.addKeyValue("receive", receiveCount)
				.log("Job failed: {}", ex.getClass().getSimpleName());
			if (receiveCount < MAX_RECEIVES) {
				return Outcome.RETRY;
			}
			Map<String, String> error = new LinkedHashMap<>();
			error.put("code", "WORKER_FAILED");
			error.put("message", ex.getClass().getSimpleName());
			sendResult(job, "failure", null, json.valueToTree(error));
			return Outcome.FAILURE;
		}
	}

	private void sendResult(JobEnvelope job, String outcome, JsonNode result, JsonNode error) {
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("job_id", job.jobId());
		payload.put("idempotency_key", job.idempotencyKey());
		payload.put("type", job.type());
		payload.put("outcome", outcome);
		payload.put("result", result);
		payload.put("error", error);
		JobEnvelope envelope = new JobEnvelope(UUID.randomUUID(), job.idempotencyKey(), JobEnvelope.RESULT_TYPE,
				JobEnvelope.VERSION, Instant.now(), json.valueToTree(payload));
		String message = json.writeValueAsString(envelope);
		String url = url(RESULTS_QUEUE);
		calls.run(ResilientCalls.SQS, () -> sqs.sendMessage(request -> request.queueUrl(url).messageBody(message)));
	}

	private void pollLoop(JobHandler handler) {
		while (running) {
			try {
				String url = url(handler.queue());
				List<Message> messages = sqs.receiveMessage(request -> request.queueUrl(url)
					.maxNumberOfMessages(1)
					.waitTimeSeconds(queues.waitSeconds())
					.messageSystemAttributeNames(MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT)).messages();
				for (Message message : messages) {
					int receives = Integer.parseInt(
							message.attributes().getOrDefault(MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT, "1"));
					Outcome outcome = process(handler, message.body(), receives);
					// Only a done job is deleted: a failure on the last receive is left, so SQS moves it to the DLQ
					if (outcome == Outcome.SUCCESS) {
						sqs.deleteMessage(request -> request.queueUrl(url).receiptHandle(message.receiptHandle()));
					}
					log.atInfo().addKeyValue("message_id", message.messageId()).addKeyValue("outcome", outcome).log("job");
				}
			}
			catch (RuntimeException ex) {
				if (running) {
					log.warn("{} poll failed: {}", handler.queue(), ex.getClass().getSimpleName());
					sleep(5_000);
				}
			}
		}
	}

	private String url(String base) {
		return urls.computeIfAbsent(base, name -> calls.call(ResilientCalls.SQS,
				() -> sqs.getQueueUrl(request -> request.queueName(queues.name(name))).queueUrl()));
	}

	@Override
	public void start() {
		if (!queues.consumerEnabled()) {
			log.info("Job workers are off (fullstar.queues.consumer-enabled=false)");
			return;
		}
		running = true;
		for (JobHandler handler : handlers) {
			threads.add(Thread.ofVirtual().name("worker-" + handler.queue()).start(() -> pollLoop(handler)));
		}
	}

	@Override
	public void stop() {
		running = false;
		threads.forEach(Thread::interrupt);
		threads.clear();
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
