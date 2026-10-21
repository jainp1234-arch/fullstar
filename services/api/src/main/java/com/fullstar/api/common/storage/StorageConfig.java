package com.fullstar.api.common.storage;

import java.net.URI;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** S3 client for R2 (Plan 1.6): path-style addressing and chunked encoding off, as R2 requires. */
@Configuration(proxyBeanMethods = false)
public class StorageConfig {

	@Bean(destroyMethod = "close")
	S3Client s3Client(StorageProperties properties) {
		var builder = S3Client.builder()
			.region(Region.of(properties.region()))
			.credentialsProvider(credentials(properties))
			.serviceConfiguration(s3Configuration())
			.httpClientBuilder(UrlConnectionHttpClient.builder()
				.connectionTimeout(Duration.ofSeconds(5))
				.socketTimeout(Duration.ofSeconds(30)))
			.overrideConfiguration(ClientOverrideConfiguration.builder().apiCallTimeout(Duration.ofSeconds(30)).build());
		if (properties.endpoint() != null && !properties.endpoint().isBlank()) {
			builder.endpointOverride(URI.create(properties.endpoint()));
		}
		return builder.build();
	}

	@Bean(destroyMethod = "close")
	S3Presigner s3Presigner(StorageProperties properties) {
		var builder = S3Presigner.builder()
			.region(Region.of(properties.region()))
			.credentialsProvider(credentials(properties))
			.serviceConfiguration(s3Configuration());
		// Signed URLs are used by browsers: sign them for the address browsers reach (Plan 5.1)
		if (properties.publicEndpoint() != null && !properties.publicEndpoint().isBlank()) {
			builder.endpointOverride(URI.create(properties.publicEndpoint()));
		}
		return builder.build();
	}

	private static S3Configuration s3Configuration() {
		return S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build();
	}

	private static StaticCredentialsProvider credentials(StorageProperties properties) {
		return StaticCredentialsProvider.create(AwsBasicCredentials.create(blankToPlaceholder(properties.accessKeyId()),
				blankToPlaceholder(properties.secretAccessKey())));
	}

	/** The SDK rejects empty credentials at start-up; calls then fail clearly instead. */
	private static String blankToPlaceholder(String value) {
		return value == null || value.isBlank() ? "unset" : value;
	}

}
