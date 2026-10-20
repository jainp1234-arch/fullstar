package com.fullstar.api.testsupport;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.Transferable;

/**
 * Trial stand-ins for the cloud (Tech Stack §8a): ElasticMQ for SQS and SeaweedFS for R2, with S3
 * keys so that signed URLs are really checked. One pair of containers per test run.
 */
public final class TestAws {

	/** Random per test run: real keys for the throwaway container, never a literal in the repo. */
	public static final String ACCESS_KEY = "test" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12);

	public static final String SECRET_KEY = java.util.UUID.randomUUID().toString() + java.util.UUID.randomUUID();

	public static final String BUCKET = "fullstar-test";

	public static final GenericContainer<?> ELASTICMQ = new GenericContainer<>("softwaremill/elasticmq:1.7.1")
		.withExposedPorts(9324)
		.waitingFor(Wait.forHttp("/?Action=ListQueues").forPort(9324).forStatusCode(200));

	public static final GenericContainer<?> SEAWEEDFS = new GenericContainer<>("chrislusf/seaweedfs:4.23")
		.withExposedPorts(8333)
		.withCopyToContainer(Transferable.of("""
				{"identities":[{"name":"test","credentials":[{"accessKey":"%s","secretKey":"%s"}],
				 "actions":["Admin","Read","Write","List","Tagging"]}]}""".formatted(ACCESS_KEY, SECRET_KEY)),
				"/etc/seaweedfs/s3.json")
		.withCommand("server", "-dir=/data", "-s3", "-s3.port=8333", "-s3.config=/etc/seaweedfs/s3.json",
				"-ip.bind=0.0.0.0", "-master.volumeSizeLimitMB=64")
		.waitingFor(Wait.forHttp("/healthz").forPort(8333).forStatusCode(200));

	static {
		ELASTICMQ.start();
		SEAWEEDFS.start();
	}

	private TestAws() {
	}

	public static String sqsEndpoint() {
		return "http://" + ELASTICMQ.getHost() + ":" + ELASTICMQ.getMappedPort(9324);
	}

	public static String s3Endpoint() {
		return "http://" + SEAWEEDFS.getHost() + ":" + SEAWEEDFS.getMappedPort(8333);
	}

	public static void register(DynamicPropertyRegistry registry) {
		registry.add("fullstar.queues.endpoint", TestAws::sqsEndpoint);
		registry.add("fullstar.queues.access-key-id", () -> "test");
		registry.add("fullstar.queues.secret-access-key", () -> "test");
		registry.add("fullstar.queues.consumer-enabled", () -> "true");
		registry.add("fullstar.queues.wait-seconds", () -> "1");
		registry.add("fullstar.storage.endpoint", TestAws::s3Endpoint);
		registry.add("fullstar.storage.region", () -> "us-east-1");
		registry.add("fullstar.storage.bucket", () -> BUCKET);
		registry.add("fullstar.storage.access-key-id", () -> ACCESS_KEY);
		registry.add("fullstar.storage.secret-access-key", () -> SECRET_KEY);
	}

}
