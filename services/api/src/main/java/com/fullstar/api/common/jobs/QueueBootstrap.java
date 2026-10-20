package com.fullstar.api.common.jobs;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

/**
 * Creates every Schema §12 queue and its DLQ with the listed visibility timeout and max receives 3.
 * Safe to run again: existing queues get their attributes set to the same values.
 */
@Component
public class QueueBootstrap {

	private static final Logger log = LoggerFactory.getLogger(QueueBootstrap.class);

	/** SQS default retention is 4 days; failed jobs are kept 14 days in the DLQ. */
	private static final String DLQ_RETENTION_SECONDS = String.valueOf(14 * 24 * 3600);

	private final SqsClient sqs;

	private final QueueProperties properties;

	public QueueBootstrap(SqsClient sqs, QueueProperties properties) {
		this.sqs = sqs;
		this.properties = properties;
	}

	public void createAll() {
		for (JobQueue queue : JobQueue.values()) {
			String dlqName = queue.deadLetterName(properties.prefix());
			String dlqUrl = sqs.createQueue(request -> request.queueName(dlqName)).queueUrl();
			sqs.setQueueAttributes(request -> request.queueUrl(dlqUrl)
				.attributes(Map.of(QueueAttributeName.MESSAGE_RETENTION_PERIOD, DLQ_RETENTION_SECONDS)));
			String dlqArn = sqs
				.getQueueAttributes(request -> request.queueUrl(dlqUrl).attributeNames(QueueAttributeName.QUEUE_ARN))
				.attributes()
				.get(QueueAttributeName.QUEUE_ARN);

			Map<QueueAttributeName, String> attributes = Map.of(QueueAttributeName.VISIBILITY_TIMEOUT,
					String.valueOf(queue.visibility().toSeconds()), QueueAttributeName.REDRIVE_POLICY,
					"{\"deadLetterTargetArn\":\"" + dlqArn + "\",\"maxReceiveCount\":\"" + JobQueue.MAX_RECEIVES + "\"}");
			String name = queue.queueName(properties.prefix());
			String url = sqs.createQueue(request -> request.queueName(name)).queueUrl();
			sqs.setQueueAttributes(request -> request.queueUrl(url).attributes(attributes));
			log.info("Queue ready: {} (dlq {})", name, dlqName);
		}
	}

}
