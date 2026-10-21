package com.fullstar.api.studio.check;

import com.fullstar.api.common.jobs.JobEnvelope;
import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.QueueProperties;
import com.fullstar.api.common.jobs.QueueUrls;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.MessageSystemAttributeName;
import tools.jackson.databind.json.JsonMapper;

/**
 * Consumes the content-check queue (Schema §12, worker "API → Claude"). Runs only when queue
 * consumers are on and FEATURE_AI_CHECK is true. A failed message stays on the queue; on its last
 * receive (3) the check is marked error, and SQS moves the message to content-check-dlq.
 */
@Component
@ConditionalOnExpression("${fullstar.queues.consumer-enabled:true} and '${fullstar.ai.check:false}'.trim().equalsIgnoreCase('true')")
public class ContentCheckConsumer implements SmartLifecycle {

	private static final Logger log = LoggerFactory.getLogger(ContentCheckConsumer.class);

	private final SqsClient sqs;

	private final QueueUrls queueUrls;

	private final QueueProperties properties;

	private final JsonMapper json;

	private final ContentCheckAgent agent;

	private volatile boolean running;

	private Thread worker;

	public ContentCheckConsumer(SqsClient sqs, QueueUrls queueUrls, QueueProperties properties, JsonMapper json,
			ContentCheckAgent agent) {
		this.sqs = sqs;
		this.queueUrls = queueUrls;
		this.properties = properties;
		this.json = json;
		this.agent = agent;
	}

	private void pollLoop() {
		while (running) {
			try {
				String url = queueUrls.of(JobQueue.CONTENT_CHECK);
				List<Message> messages = sqs.receiveMessage(request -> request.queueUrl(url)
					.maxNumberOfMessages(5)
					.waitTimeSeconds(properties.waitSeconds())
					.messageSystemAttributeNames(MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT)).messages();
				for (Message message : messages) {
					handle(url, message);
				}
			}
			catch (RuntimeException ex) {
				if (running) {
					log.warn("content-check poll failed: {}", ex.getClass().getSimpleName());
					sleep(5_000);
				}
			}
		}
	}

	private void handle(String url, Message message) {
		UUID checkId = null;
		try {
			JobEnvelope envelope = json.readValue(message.body(), JobEnvelope.class);
			checkId = UUID.fromString(envelope.payload().path("content_check_id").asString());
			ContentCheckAgent.Outcome outcome = agent.run(checkId, envelope.idempotencyKey());
			sqs.deleteMessage(request -> request.queueUrl(url).receiptHandle(message.receiptHandle()));
			log.atInfo().addKeyValue("message_id", message.messageId()).addKeyValue("outcome", outcome).log("content check");
		}
		catch (RuntimeException ex) {
			int receives = Integer.parseInt(
					message.attributes().getOrDefault(MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT, "1"));
			log.warn("content check {} failed (receive {}): {}", message.messageId(), receives,
					ex.getClass().getSimpleName());
			if (checkId != null && receives >= JobQueue.MAX_RECEIVES) {
				agent.giveUp(checkId, "The content check could not be completed");
			}
		}
	}

	@Override
	public void start() {
		running = true;
		worker = Thread.ofVirtual().name("content-check-consumer").start(this::pollLoop);
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
