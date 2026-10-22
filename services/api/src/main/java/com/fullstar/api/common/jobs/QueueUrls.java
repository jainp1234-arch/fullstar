package com.fullstar.api.common.jobs;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;

/** Queue URLs, looked up once per queue. */
@Component
public class QueueUrls {

	private final SqsClient sqs;

	private final QueueProperties properties;

	private final Map<JobQueue, String> urls = new ConcurrentHashMap<>();

	private final Map<JobQueue, String> deadLetterUrls = new ConcurrentHashMap<>();

	public QueueUrls(SqsClient sqs, QueueProperties properties) {
		this.sqs = sqs;
		this.properties = properties;
	}

	public String of(JobQueue queue) {
		return urls.computeIfAbsent(queue,
				q -> sqs.getQueueUrl(request -> request.queueName(q.queueName(properties.prefix()))).queueUrl());
	}

	public String deadLetterOf(JobQueue queue) {
		return deadLetterUrls.computeIfAbsent(queue,
				q -> sqs.getQueueUrl(request -> request.queueName(q.deadLetterName(properties.prefix()))).queueUrl());
	}

}
