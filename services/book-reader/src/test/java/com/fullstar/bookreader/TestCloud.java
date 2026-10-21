package com.fullstar.bookreader;

import com.fullstar.bookreader.jobs.JobEnvelope;
import com.fullstar.bookreader.pages.FakeTools;
import com.fullstar.bookreader.scan.FakeClamd;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.Transferable;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The whole book-reader against trial stand-ins (Tech Stack §8a): ElasticMQ, SeaweedFS with real S3
 * keys and a stand-in clamd. One set of containers per test run; queues and the bucket exist.
 */
@SpringBootTest
@Import(TestCloud.Tools.class)
public abstract class TestCloud {

	/** The OCR and WebP tools only exist in the built image; flow tests use fakes (RealToolsImageTest covers them). */
	@TestConfiguration(proxyBeanMethods = false)
	static class Tools {

		@Bean
		@Primary
		FakeTools fakeTools() {
			return new FakeTools();
		}

	}

	static final String ACCESS_KEY = "test" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

	static final String SECRET_KEY = UUID.randomUUID().toString() + UUID.randomUUID();

	public static final String BUCKET = "fullstar-test";

	static final GenericContainer<?> ELASTICMQ = new GenericContainer<>("softwaremill/elasticmq:1.7.1")
		.withExposedPorts(9324)
		.waitingFor(Wait.forHttp("/?Action=ListQueues").forPort(9324).forStatusCode(200));

	static final GenericContainer<?> SEAWEEDFS = new GenericContainer<>("chrislusf/seaweedfs:4.23")
		.withExposedPorts(8333)
		.withCopyToContainer(Transferable.of("""
				{"identities":[{"name":"test","credentials":[{"accessKey":"%s","secretKey":"%s"}],
				 "actions":["Admin","Read","Write","List","Tagging"]}]}""".formatted(ACCESS_KEY, SECRET_KEY)),
				"/etc/seaweedfs/s3.json")
		.withCommand("server", "-dir=/data", "-s3", "-s3.port=8333", "-s3.config=/etc/seaweedfs/s3.json",
				"-ip.bind=0.0.0.0", "-master.volumeSizeLimitMB=64")
		.waitingFor(Wait.forHttp("/healthz").forPort(8333).forStatusCode(200));

	protected static final FakeClamd CLAMD = startClamd();

	static {
		ELASTICMQ.start();
		SEAWEEDFS.start();
		try (SqsClient client = SqsClient.builder()
			.endpointOverride(URI.create(sqsEndpoint()))
			.region(Region.AP_SOUTH_1)
			.credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
			.build()) {
			for (String name : List.of("upload-scan", "book-process", "readalong-narrate", "job-results")) {
				client.createQueue(request -> request.queueName(name));
			}
		}
	}

	@Autowired
	protected SqsClient sqs;

	@Autowired
	protected S3Client s3;

	@Autowired
	protected JsonMapper json;

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("fullstar.queues.endpoint", TestCloud::sqsEndpoint);
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

	static String sqsEndpoint() {
		return "http://" + ELASTICMQ.getHost() + ":" + ELASTICMQ.getMappedPort(9324);
	}

	protected String put(byte[] content) {
		return putAt("families/" + UUID.randomUUID() + "/uploads/" + UUID.randomUUID() + "/" + UUID.randomUUID(), content);
	}

	protected String putAt(String key, byte[] content) {
		try {
			s3.headBucket(r -> r.bucket(BUCKET));
		}
		catch (NoSuchBucketException ex) {
			s3.createBucket(r -> r.bucket(BUCKET));
		}
		s3.putObject(r -> r.bucket(BUCKET).key(key), RequestBody.fromBytes(content));
		return key;
	}

	protected byte[] get(String key) {
		return s3.getObjectAsBytes(r -> r.bucket(BUCKET).key(key)).asByteArray();
	}

	protected String envelope(String type, String key, Object payload) {
		return json.writeValueAsString(new JobEnvelope(UUID.randomUUID(), key, type, 1, Instant.now(),
				json.valueToTree(payload)));
	}

	protected void send(String queue, String body) {
		String url = sqs.getQueueUrl(r -> r.queueName(queue)).queueUrl();
		sqs.sendMessage(r -> r.queueUrl(url).messageBody(body));
	}

	/** The job.result for this idempotency key from job-results (waits up to 60 s). */
	protected JsonNode resultFor(String idempotencyKey) {
		String url = sqs.getQueueUrl(r -> r.queueName("job-results")).queueUrl();
		Instant until = Instant.now().plus(Duration.ofSeconds(60));
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

	private static FakeClamd startClamd() {
		try {
			return new FakeClamd();
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

}
