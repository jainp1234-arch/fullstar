package com.fullstar.api.common.jobs;

import com.fullstar.api.common.storage.StorageProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;

/**
 * make bootstrap (profile "bootstrap"): creates the Schema §12 queues and DLQs and, in trial mode,
 * the storage bucket. The application then exits (no web server in this profile).
 */
@Component
@Profile("bootstrap")
public class BootstrapRunner implements ApplicationRunner {

	private static final Logger log = LoggerFactory.getLogger(BootstrapRunner.class);

	private final QueueBootstrap queues;

	private final S3Client s3;

	private final StorageProperties storage;

	public BootstrapRunner(QueueBootstrap queues, S3Client s3, StorageProperties storage) {
		this.queues = queues;
		this.s3 = s3;
		this.storage = storage;
	}

	@Override
	public void run(ApplicationArguments args) {
		queues.createAll();
		if (storage.createBucket()) {
			try {
				s3.headBucket(request -> request.bucket(storage.bucket()));
				log.info("Bucket exists: {}", storage.bucket());
			}
			catch (NoSuchBucketException ex) {
				s3.createBucket(request -> request.bucket(storage.bucket()));
				log.info("Bucket created: {}", storage.bucket());
			}
		}
	}

}
