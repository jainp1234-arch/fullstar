package com.fullstar.bookreader;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.bookreader.jobs.JobEnvelope;
import com.fullstar.bookreader.jobs.JobWorkers;
import com.fullstar.bookreader.scan.FakeClamd;
import com.fullstar.bookreader.scan.UploadScanHandler;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.Transferable;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Plan 5.2: upload-scan on real ElasticMQ and SeaweedFS, with a stand-in clamd. */
@SpringBootTest
class UploadScanFlowTest {

	private static final String ACCESS_KEY = "test" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

	private static final String SECRET_KEY = UUID.randomUUID().toString() + UUID.randomUUID();

	private static final String BUCKET = "fullstar-test";

	private static final GenericContainer<?> ELASTICMQ = new GenericContainer<>("softwaremill/elasticmq:1.7.1")
		.withExposedPorts(9324)
		.waitingFor(Wait.forHttp("/?Action=ListQueues").forPort(9324).forStatusCode(200));

	private static final GenericContainer<?> SEAWEEDFS = new GenericContainer<>("chrislusf/seaweedfs:4.23")
		.withExposedPorts(8333)
		.withCopyToContainer(Transferable.of("""
				{"identities":[{"name":"test","credentials":[{"accessKey":"%s","secretKey":"%s"}],
				 "actions":["Admin","Read","Write","List","Tagging"]}]}""".formatted(ACCESS_KEY, SECRET_KEY)),
				"/etc/seaweedfs/s3.json")
		.withCommand("server", "-dir=/data", "-s3", "-s3.port=8333", "-s3.config=/etc/seaweedfs/s3.json",
				"-ip.bind=0.0.0.0", "-master.volumeSizeLimitMB=64")
		.waitingFor(Wait.forHttp("/healthz").forPort(8333).forStatusCode(200));

	private static final FakeClamd CLAMD = startClamd();

	static {
		ELASTICMQ.start();
		SEAWEEDFS.start();
	}

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("fullstar.queues.endpoint",
				() -> "http://" + ELASTICMQ.getHost() + ":" + ELASTICMQ.getMappedPort(9324));
		registry.add("fullstar.queues.access-key-id", () -> "test");
		registry.add("fullstar.queues.secret-access-key", () -> "test");
		registry.add("fullstar.queues.wait-seconds", () -> "1");
		registry.add("fullstar.storage.endpoint",
				() -> "http://" + SEAWEEDFS.getHost() + ":" + SEAWEEDFS.getMappedPort(8333));
		registry.add("fullstar.storage.region", () -> "us-east-1");
		registry.add("fullstar.storage.bucket", () -> BUCKET);
		registry.add("fullstar.storage.access-key-id", () -> ACCESS_KEY);
		registry.add("fullstar.storage.secret-access-key", () -> SECRET_KEY);
		registry.add("fullstar.clamav.host", () -> "127.0.0.1");
		registry.add("fullstar.clamav.port", CLAMD::port);
		registry.add("fullstar.clamav.timeout", () -> "5s");
	}

	@Autowired
	private SqsClient sqs;

	@Autowired
	private S3Client s3;

	@Autowired
	private JsonMapper json;

	@Autowired
	private JobWorkers workers;

	@Autowired
	private UploadScanHandler handler;

	@BeforeAll
	static void queuesAndBucket() {
		try (SqsClient client = SqsClient.builder()
			.endpointOverride(java.net.URI.create("http://" + ELASTICMQ.getHost() + ":" + ELASTICMQ.getMappedPort(9324)))
			.region(software.amazon.awssdk.regions.Region.AP_SOUTH_1)
			.credentialsProvider(software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
				.create(software.amazon.awssdk.auth.credentials.AwsBasicCredentials.create("test", "test")))
			.build()) {
			for (String name : List.of("upload-scan", "job-results")) {
				client.createQueue(request -> request.queueName(name));
			}
		}
	}

	@AfterEach
	void normalClamd() {
		CLAMD.reply(null);
	}

	private String put(String content) {
		try {
			s3.headBucket(r -> r.bucket(BUCKET));
		}
		catch (software.amazon.awssdk.services.s3.model.NoSuchBucketException ex) {
			s3.createBucket(r -> r.bucket(BUCKET));
		}
		String key = "families/" + UUID.randomUUID() + "/uploads/" + UUID.randomUUID() + "/" + UUID.randomUUID();
		s3.putObject(r -> r.bucket(BUCKET).key(key), RequestBody.fromString(content, StandardCharsets.ISO_8859_1));
		return key;
	}

	private String job(String key, List<String> objectKeys) {
		return json.writeValueAsString(new JobEnvelope(UUID.randomUUID(), key, "upload.scan", 1, Instant.now(),
				json.valueToTree(Map.of("upload_id", UUID.randomUUID().toString(), "object_keys", objectKeys))));
	}

	private JsonNode resultFor(String idempotencyKey) {
		String url = sqs.getQueueUrl(r -> r.queueName("job-results")).queueUrl();
		Instant until = Instant.now().plus(Duration.ofSeconds(30));
		while (Instant.now().isBefore(until)) {
			for (Message message : sqs.receiveMessage(r -> r.queueUrl(url).maxNumberOfMessages(10).waitTimeSeconds(1))
				.messages()) {
				JsonNode envelope = json.readTree(message.body());
				if (idempotencyKey.equals(envelope.path("idempotency_key").asString())) {
					sqs.deleteMessage(r -> r.queueUrl(url).receiptHandle(message.receiptHandle()));
					return envelope;
				}
			}
		}
		throw new AssertionError("no job result for " + idempotencyKey);
	}

	@Test
	void aCleanUploadIsReportedCleanAndTheJobIsDeleted() {
		String key = "upload.scan:" + UUID.randomUUID();
		String clean = put("%PDF-1.7 a clean page");
		String url = sqs.getQueueUrl(r -> r.queueName("upload-scan")).queueUrl();
		sqs.sendMessage(r -> r.queueUrl(url).messageBody(job(key, List.of(clean))));

		JsonNode envelope = resultFor(key);
		assertThat(envelope.path("type").asString()).isEqualTo("job.result");
		JsonNode payload = envelope.path("payload");
		assertThat(payload.path("type").asString()).isEqualTo("upload.scan");
		assertThat(payload.path("outcome").asString()).isEqualTo("success");
		assertThat(payload.path("result").path("infected").asBoolean()).isFalse();
		assertThat(payload.path("result").path("files").get(0).path("result").asString()).isEqualTo("clean");
		assertThat(sqs.receiveMessage(r -> r.queueUrl(url).waitTimeSeconds(1)).messages()).isEmpty();
	}

	@Test
	void theEicarTestFileIsReportedInfected() {
		String key = "upload.scan:" + UUID.randomUUID();
		String clean = put("a clean photo");
		String infected = put(FakeClamd.EICAR);
		String url = sqs.getQueueUrl(r -> r.queueName("upload-scan")).queueUrl();
		sqs.sendMessage(r -> r.queueUrl(url).messageBody(job(key, List.of(clean, infected))));

		JsonNode result = resultFor(key).path("payload").path("result");
		assertThat(result.path("infected").asBoolean()).isTrue();
		assertThat(result.path("files").get(0).path("result").asString()).isEqualTo("clean");
		assertThat(result.path("files").get(1).path("result").asString()).isEqualTo("infected");
		assertThat(result.path("files").get(1).path("signature").asString()).isEqualTo("Eicar-Test-Signature");
	}

	@Test
	void aScanThatKeepsFailingIsRetriedThenReportedAsAFailure() {
		CLAMD.reply("INSTREAM size limit exceeded. ERROR");
		String key = "upload.scan:" + UUID.randomUUID();
		String body = job(key, List.of(put("pages")));
		assertThat(workers.process(handler, body, 1)).isEqualTo(JobWorkers.Outcome.RETRY);
		assertThat(workers.process(handler, body, JobWorkers.MAX_RECEIVES)).isEqualTo(JobWorkers.Outcome.FAILURE);
		JsonNode payload = resultFor(key).path("payload");
		assertThat(payload.path("outcome").asString()).isEqualTo("failure");
		assertThat(payload.path("error").path("code").asString()).isEqualTo("WORKER_FAILED");
	}

	private static FakeClamd startClamd() {
		try {
			return new FakeClamd();
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

}
