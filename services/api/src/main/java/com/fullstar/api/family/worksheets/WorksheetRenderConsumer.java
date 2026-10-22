package com.fullstar.api.family.worksheets;

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
 * Consumes worksheet-render (Schema §12, worker "API → Gotenberg"; Plan 7.2). Rendering the same
 * worksheet again only replaces its PDF, so a repeated message is harmless. A failed render stays
 * on the queue; on its last receive (3) the worksheet is marked failed and SQS moves the message to
 * worksheet-render-dlq. Asking for the PDF again (P12) queues a new render.
 */
@Component
@ConditionalOnExpression("${fullstar.queues.consumer-enabled:true}")
public class WorksheetRenderConsumer implements SmartLifecycle {

	private static final Logger log = LoggerFactory.getLogger(WorksheetRenderConsumer.class);

	private final SqsClient sqs;

	private final QueueUrls queueUrls;

	private final QueueProperties properties;

	private final JsonMapper json;

	private final WorksheetRenderer renderer;

	private volatile boolean running;

	private Thread worker;

	public WorksheetRenderConsumer(SqsClient sqs, QueueUrls queueUrls, QueueProperties properties, JsonMapper json,
			WorksheetRenderer renderer) {
		this.sqs = sqs;
		this.queueUrls = queueUrls;
		this.properties = properties;
		this.json = json;
		this.renderer = renderer;
	}

	private void pollLoop() {
		while (running) {
			try {
				String url = queueUrls.of(JobQueue.WORKSHEET_RENDER);
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
					log.warn("worksheet-render poll failed: {}", ex.getClass().getSimpleName());
					sleep(5_000);
				}
			}
		}
	}

	private void handle(String url, Message message) {
		UUID worksheetId = null;
		try {
			JobEnvelope envelope = json.readValue(message.body(), JobEnvelope.class);
			worksheetId = UUID.fromString(envelope.payload().path("worksheet_id").asString());
			boolean rendered = renderer.render(worksheetId);
			sqs.deleteMessage(request -> request.queueUrl(url).receiptHandle(message.receiptHandle()));
			log.atInfo().addKeyValue("message_id", message.messageId()).addKeyValue("rendered", rendered)
				.log("worksheet render");
		}
		catch (RuntimeException ex) {
			int receives = Integer.parseInt(
					message.attributes().getOrDefault(MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT, "1"));
			log.warn("worksheet render {} failed (receive {}): {}", message.messageId(), receives,
					ex.getClass().getSimpleName());
			if (worksheetId != null && receives >= JobQueue.MAX_RECEIVES) {
				renderer.failed(worksheetId);
			}
		}
	}

	@Override
	public void start() {
		running = true;
		worker = Thread.ofVirtual().name("worksheet-render-consumer").start(this::pollLoop);
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
