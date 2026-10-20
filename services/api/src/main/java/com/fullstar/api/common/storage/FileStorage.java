package com.fullstar.api.common.storage;

import com.fullstar.api.common.resilience.Dependency;
import com.fullstar.api.common.resilience.ResilientCalls;
import java.net.URL;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.Delete;
import software.amazon.awssdk.services.s3.model.DeleteObjectsRequest;
import software.amazon.awssdk.services.s3.model.ObjectIdentifier;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

/**
 * Files in R2 (Schema §1 rule 7, §8.4): tables keep only the key; every access uses a signed URL
 * valid for 10 minutes. Signing is local (no network), deletes go through ResilientCalls.
 */
@Service
public class FileStorage {

	public static final Duration URL_VALIDITY = Duration.ofMinutes(10);

	private static final int DELETE_BATCH = 1000;

	private final S3Client s3;

	private final S3Presigner presigner;

	private final StorageProperties properties;

	private final ResilientCalls resilientCalls;

	public FileStorage(S3Client s3, S3Presigner presigner, StorageProperties properties, ResilientCalls resilientCalls) {
		this.s3 = s3;
		this.presigner = presigner;
		this.properties = properties;
		this.resilientCalls = resilientCalls;
	}

	public record SignedUrl(URL url, String method, Instant expiresAt) {
	}

	/** Upload URL; the client must send the same Content-Type. */
	public SignedUrl signedPut(String key, String contentType) {
		var request = PutObjectPresignRequest.builder()
			.signatureDuration(URL_VALIDITY)
			.putObjectRequest(put -> put.bucket(properties.bucket()).key(key).contentType(contentType))
			.build();
		var presigned = presigner.presignPutObject(request);
		return new SignedUrl(presigned.url(), "PUT", presigned.expiration());
	}

	public SignedUrl signedGet(String key) {
		var request = GetObjectPresignRequest.builder()
			.signatureDuration(URL_VALIDITY)
			.getObjectRequest(get -> get.bucket(properties.bucket()).key(key))
			.build();
		var presigned = presigner.presignGetObject(request);
		return new SignedUrl(presigned.url(), "GET", presigned.expiration());
	}

	/** Deletes keys returned by run_retention or a family deletion (Schema §13). */
	public void delete(List<String> keys) {
		for (int from = 0; from < keys.size(); from += DELETE_BATCH) {
			List<ObjectIdentifier> batch = keys.subList(from, Math.min(keys.size(), from + DELETE_BATCH))
				.stream()
				.map(key -> ObjectIdentifier.builder().key(key).build())
				.toList();
			resilientCalls.call(Dependency.R2, () -> s3.deleteObjects(DeleteObjectsRequest.builder()
				.bucket(properties.bucket())
				.delete(Delete.builder().objects(batch).quiet(true).build())
				.build()));
		}
	}

}
