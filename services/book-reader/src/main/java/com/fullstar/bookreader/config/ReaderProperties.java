package com.fullstar.bookreader.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * fullstar.*: the queues (SQS; trial ElasticMQ), file storage (R2; trial SeaweedFS) and ClamAV of
 * book-reader (Tech Stack §7; Plan 5.2). book-reader never touches the database: it reads files,
 * does the work and reports to job-results.
 */
@ConfigurationProperties("fullstar")
public record ReaderProperties(Queues queues, Storage storage, Clamav clamav) {

	public ReaderProperties {
		queues = queues == null ? new Queues(null, null, null, null, null, true, 20) : queues;
		storage = storage == null ? new Storage(null, null, null, null, null) : storage;
		clamav = clamav == null ? new Clamav(null, 0, null) : clamav;
	}

	public record Queues(String endpoint, String region, String accessKeyId, String secretAccessKey, String prefix,
			boolean consumerEnabled, int waitSeconds) {

		public Queues {
			region = region == null || region.isBlank() ? "ap-south-1" : region;
			prefix = prefix == null ? "" : prefix.strip();
		}

		public String name(String base) {
			return prefix + base;
		}

	}

	public record Storage(String endpoint, String region, String bucket, String accessKeyId, String secretAccessKey) {

		public Storage {
			region = region == null || region.isBlank() ? "auto" : region;
		}

	}

	/** clamd over TCP (INSTREAM). timeout covers one whole file. */
	public record Clamav(String host, int port, Duration timeout) {

		public Clamav {
			host = host == null || host.isBlank() ? "localhost" : host.strip();
			port = port <= 0 ? 3310 : port;
			timeout = timeout == null ? Duration.ofSeconds(120) : timeout;
		}

	}

}
