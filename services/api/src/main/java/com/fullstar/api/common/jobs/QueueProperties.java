package com.fullstar.api.common.jobs;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * fullstar.queues.*: AWS SQS (trial: ElasticMQ). prefix is put in front of every Schema §12 queue
 * name (empty in trial). consumerEnabled runs the job-results consumer in this process.
 */
@ConfigurationProperties("fullstar.queues")
public record QueueProperties(String endpoint, String region, String accessKeyId, String secretAccessKey,
		String prefix, boolean consumerEnabled, Integer waitSeconds) {

	public QueueProperties {
		region = region == null || region.isBlank() ? "ap-south-1" : region;
		prefix = prefix == null ? "" : prefix;
		waitSeconds = waitSeconds == null ? 20 : Math.max(0, Math.min(20, waitSeconds));
	}

}
