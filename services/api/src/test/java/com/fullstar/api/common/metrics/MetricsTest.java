package com.fullstar.api.common.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.QueueUrls;
import com.fullstar.api.testsupport.ApiTestSupport;
import io.micrometer.core.instrument.MeterRegistry;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.metrics.test.autoconfigure.AutoConfigureMetrics;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalManagementPort;
import org.springframework.boot.test.web.server.LocalServerPort;
import software.amazon.awssdk.services.sqs.SqsClient;

/** Plan 9.1: queue, DLQ and prep gauges, and Prometheus metrics on the management port only. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "management.server.port=0", "fullstar.metrics.queue-refresh=1h",
				"fullstar.metrics.prep-refresh=1h" })
@AutoConfigureMetrics
class MetricsTest extends ApiTestSupport {

	private static final HttpClient HTTP = HttpClient.newHttpClient();

	@Autowired
	private SqsClient sqs;

	@Autowired
	private QueueUrls queueUrls;

	@Autowired
	private QueueDepthMetrics queueDepths;

	@Autowired
	private PrepMetrics prep;

	@Autowired
	private MeterRegistry registry;

	@LocalServerPort
	private int serverPort;

	@LocalManagementPort
	private int managementPort;

	private double depth(JobQueue queue, String kind) {
		return registry.get(QueueDepthMetrics.METRIC).tag("queue", queue.baseName()).tag("kind", kind).gauge().value();
	}

	private static HttpResponse<String> get(int port, String path) throws Exception {
		return HTTP.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET().build(),
				HttpResponse.BodyHandlers.ofString());
	}

	@Test
	void aMessageInADeadLetterQueueIsCountedAndServedToPrometheus() throws Exception {
		String dlq = queueUrls.deadLetterOf(JobQueue.WORKSHEET_RENDER);
		String body = "{\"forced\":\"" + UUID.randomUUID() + "\"}";
		sqs.sendMessage(r -> r.queueUrl(dlq).messageBody(body));
		try {
			queueDepths.refresh();
			assertThat(depth(JobQueue.WORKSHEET_RENDER, "dlq")).isGreaterThanOrEqualTo(1);
			assertThat(depth(JobQueue.WORKSHEET_RENDER, "main")).isGreaterThanOrEqualTo(0);

			// Never on the public port (Caddy proxies only /api)
			assertThat(get(serverPort, "/actuator/prometheus").statusCode()).isIn(401, 403, 404);

			HttpResponse<String> metrics = get(managementPort, "/actuator/prometheus");
			assertThat(metrics.statusCode()).isEqualTo(200);
			assertThat(metrics.body()).containsPattern(
					"fullstar_queue_messages\\{[^}]*kind=\"dlq\"[^}]*queue=\"worksheet-render\"[^}]*} [1-9]");
			assertThat(metrics.body()).contains("http_server_requests_seconds", "application=\"api\"");
		}
		finally {
			sqs.purgeQueue(r -> r.queueUrl(dlq));
		}
	}

	@Test
	void prepTasksAreCountedWithoutNamingAnyone() {
		prep.refresh();
		assertThat(registry.get("fullstar.prep.tasks").tag("status", "open").gauge().value()).isNotNaN()
			.isGreaterThanOrEqualTo(0);
		assertThat(registry.get("fullstar.prep.oldest.age").gauge().value()).isNotNaN();
		assertThat(registry.get("fullstar.prep.turnaround").gauge()).isNotNull();
	}

}
