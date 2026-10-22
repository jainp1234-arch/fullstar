package com.fullstar.api.common.metrics;

import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.QueueUrls;
import com.fullstar.api.common.resilience.Dependency;
import com.fullstar.api.common.resilience.ResilientCalls;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

/**
 * Plan 9.1: messages waiting or in flight on every Schema §12 queue and its DLQ, as
 * fullstar_queue_messages{queue, kind=main|dlq}. A queue that cannot be read shows no value (NaN)
 * rather than a stale one; the "API down" alert covers a missing API.
 */
@Component
public class QueueDepthMetrics {

	static final String METRIC = "fullstar.queue.messages";

	private static final Logger log = LoggerFactory.getLogger(QueueDepthMetrics.class);

	private final SqsClient sqs;

	private final QueueUrls queueUrls;

	private final ResilientCalls resilientCalls;

	private final Map<String, Double> depths = new ConcurrentHashMap<>();

	public QueueDepthMetrics(SqsClient sqs, QueueUrls queueUrls, ResilientCalls resilientCalls,
			MeterRegistry registry) {
		this.sqs = sqs;
		this.queueUrls = queueUrls;
		this.resilientCalls = resilientCalls;
		for (JobQueue queue : JobQueue.values()) {
			for (Kind kind : Kind.values()) {
				String key = key(queue, kind);
				Gauge.builder(METRIC, depths, d -> d.getOrDefault(key, Double.NaN))
					.description("Messages waiting or in flight")
					.tag("queue", queue.baseName())
					.tag("kind", kind.tag)
					.register(registry);
			}
		}
	}

	@Scheduled(initialDelayString = "${fullstar.metrics.queue-refresh:30s}",
			fixedDelayString = "${fullstar.metrics.queue-refresh:30s}")
	public void refresh() {
		for (JobQueue queue : JobQueue.values()) {
			for (Kind kind : Kind.values()) {
				depths.put(key(queue, kind), read(queue, kind));
			}
		}
	}

	private double read(JobQueue queue, Kind kind) {
		try {
			return resilientCalls.call(Dependency.SQS, () -> {
				String url = kind == Kind.MAIN ? queueUrls.of(queue) : queueUrls.deadLetterOf(queue);
				Map<String, String> attributes = sqs
					.getQueueAttributes(request -> request.queueUrl(url)
						.attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES,
								QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES_NOT_VISIBLE))
					.attributesAsStrings();
				return (double) (count(attributes, QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
						+ count(attributes, QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES_NOT_VISIBLE));
			});
		}
		catch (RuntimeException ex) {
			log.atWarn()
				.addKeyValue("queue", queue.baseName())
				.addKeyValue("kind", kind.tag)
				.log("Queue depth not read: {}", ex.getClass().getSimpleName());
			return Double.NaN;
		}
	}

	private static long count(Map<String, String> attributes, QueueAttributeName name) {
		String value = attributes.get(name.toString());
		return value == null ? 0 : Long.parseLong(value);
	}

	private static String key(JobQueue queue, Kind kind) {
		return queue.baseName() + "/" + kind.tag;
	}

	private enum Kind {

		MAIN("main"), DLQ("dlq");

		private final String tag;

		Kind(String tag) {
			this.tag = tag;
		}

	}

}
