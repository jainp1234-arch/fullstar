package com.fullstar.api.common.storage;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * fullstar.storage.*: Cloudflare R2 (trial: SeaweedFS) through the S3 API. endpoint empty = AWS
 * default endpoints. createBucket: trial only, the bootstrap command creates the bucket.
 */
@ConfigurationProperties("fullstar.storage")
public record StorageProperties(String endpoint, String region, String bucket, String accessKeyId,
		String secretAccessKey, boolean createBucket) {

	public StorageProperties {
		region = region == null || region.isBlank() ? "auto" : region;
	}

}
