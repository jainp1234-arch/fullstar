package com.fullstar.bookreader.config;

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
import software.amazon.awssdk.services.sqs.SqsClient;

/** S3 (R2: path-style, no chunked encoding) and SQS clients, like services/api (Plan 1.6). */
@Configuration(proxyBeanMethods = false)
public class AwsConfig {

	@Bean(destroyMethod = "close")
	S3Client s3Client(ReaderProperties properties) {
		ReaderProperties.Storage storage = properties.storage();
		var builder = S3Client.builder()
			.region(Region.of(storage.region()))
			.credentialsProvider(credentials(storage.accessKeyId(), storage.secretAccessKey()))
			.serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build())
			.httpClientBuilder(UrlConnectionHttpClient.builder()
				.connectionTimeout(Duration.ofSeconds(5))
				.socketTimeout(Duration.ofSeconds(60)))
			.overrideConfiguration(ClientOverrideConfiguration.builder().apiCallTimeout(Duration.ofMinutes(2)).build());
		if (storage.endpoint() != null && !storage.endpoint().isBlank()) {
			builder.endpointOverride(URI.create(storage.endpoint()));
		}
		return builder.build();
	}

	@Bean(destroyMethod = "close")
	SqsClient sqsClient(ReaderProperties properties) {
		ReaderProperties.Queues queues = properties.queues();
		var builder = SqsClient.builder()
			.region(Region.of(queues.region()))
			.credentialsProvider(credentials(queues.accessKeyId(), queues.secretAccessKey()))
			.httpClientBuilder(UrlConnectionHttpClient.builder()
				.connectionTimeout(Duration.ofSeconds(5))
				// Long polling waits up to 20 seconds
				.socketTimeout(Duration.ofSeconds(30)))
			.overrideConfiguration(ClientOverrideConfiguration.builder().apiCallTimeout(Duration.ofSeconds(35)).build());
		if (queues.endpoint() != null && !queues.endpoint().isBlank()) {
			builder.endpointOverride(URI.create(queues.endpoint()));
		}
		return builder.build();
	}

	/** The SDK rejects empty credentials at start-up; calls then fail clearly instead. */
	private static StaticCredentialsProvider credentials(String key, String secret) {
		return StaticCredentialsProvider.create(AwsBasicCredentials.create(key == null || key.isBlank() ? "unset" : key,
				secret == null || secret.isBlank() ? "unset" : secret));
	}

}
