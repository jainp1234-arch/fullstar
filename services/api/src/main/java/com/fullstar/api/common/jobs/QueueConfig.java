package com.fullstar.api.common.jobs;

import java.net.URI;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;

@Configuration(proxyBeanMethods = false)
public class QueueConfig {

	@Bean(destroyMethod = "close")
	SqsClient sqsClient(QueueProperties properties) {
		var builder = SqsClient.builder()
			.region(Region.of(properties.region()))
			.credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials
				.create(orPlaceholder(properties.accessKeyId()), orPlaceholder(properties.secretAccessKey()))))
			.httpClientBuilder(UrlConnectionHttpClient.builder()
				.connectionTimeout(Duration.ofSeconds(5))
				// Long polling waits up to 20 seconds
				.socketTimeout(Duration.ofSeconds(30)))
			.overrideConfiguration(ClientOverrideConfiguration.builder().apiCallTimeout(Duration.ofSeconds(35)).build());
		if (properties.endpoint() != null && !properties.endpoint().isBlank()) {
			builder.endpointOverride(URI.create(properties.endpoint()));
		}
		return builder.build();
	}

	private static String orPlaceholder(String value) {
		return value == null || value.isBlank() ? "unset" : value;
	}

}
