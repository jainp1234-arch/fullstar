package com.fullstar.api.storage;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.api.common.storage.FileStorage;
import com.fullstar.api.common.storage.StorageKeys;
import com.fullstar.api.testsupport.ApiTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** Signed URLs against SeaweedFS with S3 keys (trial stand-in for R2). */
class FileStorageTest extends ApiTestSupport {

	private static final HttpClient HTTP = HttpClient.newHttpClient();

	@Autowired
	private FileStorage storage;

	@Test
	void signedPutThenSignedGetRoundTripsAFile() throws Exception {
		String key = StorageKeys.upload(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
		byte[] content = "%PDF-1.7 test".getBytes(StandardCharsets.US_ASCII);

		FileStorage.SignedUrl put = storage.signedPut(key, "application/pdf");
		assertThat(put.method()).isEqualTo("PUT");
		assertThat(put.url().getQuery()).contains("X-Amz-Expires=600");
		assertThat(Duration.between(Instant.now(), put.expiresAt())).isBetween(Duration.ofMinutes(9), Duration.ofMinutes(10));
		HttpResponse<String> uploaded = HTTP.send(HttpRequest.newBuilder(put.url().toURI())
			.header("Content-Type", "application/pdf")
			.PUT(HttpRequest.BodyPublishers.ofByteArray(content))
			.build(), HttpResponse.BodyHandlers.ofString());
		assertThat(uploaded.statusCode()).isEqualTo(200);

		FileStorage.SignedUrl get = storage.signedGet(key);
		HttpResponse<byte[]> downloaded = HTTP.send(HttpRequest.newBuilder(get.url().toURI()).GET().build(),
				HttpResponse.BodyHandlers.ofByteArray());
		assertThat(downloaded.statusCode()).isEqualTo(200);
		assertThat(downloaded.body()).isEqualTo(content);
	}

	@Test
	void urlsWithoutAValidSignatureAreRefused() throws Exception {
		String key = StorageKeys.page(UUID.randomUUID(), UUID.randomUUID());
		storageUpload(key);
		String signed = storage.signedGet(key).url().toString();
		String tampered = signed.replaceAll("X-Amz-Signature=[0-9a-f]{4}", "X-Amz-Signature=0000");
		String unsigned = signed.substring(0, signed.indexOf('?'));
		for (String url : List.of(tampered, unsigned)) {
			HttpResponse<String> response = HTTP.send(HttpRequest.newBuilder(URI.create(url)).GET().build(),
					HttpResponse.BodyHandlers.ofString());
			assertThat(response.statusCode()).as(url.equals(unsigned) ? "unsigned" : "tampered").isEqualTo(403);
		}
	}

	@Test
	void deleteRemovesObjects() throws Exception {
		String key = StorageKeys.worksheet(UUID.randomUUID(), UUID.randomUUID());
		storageUpload(key);
		storage.delete(List.of(key));
		HttpResponse<String> response = HTTP.send(HttpRequest.newBuilder(storage.signedGet(key).url().toURI()).GET().build(),
				HttpResponse.BodyHandlers.ofString());
		assertThat(response.statusCode()).isEqualTo(404);
	}

	private void storageUpload(String key) throws Exception {
		FileStorage.SignedUrl put = storage.signedPut(key, "application/octet-stream");
		HttpResponse<String> response = HTTP.send(HttpRequest.newBuilder(put.url().toURI())
			.header("Content-Type", "application/octet-stream")
			.PUT(HttpRequest.BodyPublishers.ofString("x"))
			.build(), HttpResponse.BodyHandlers.ofString());
		assertThat(response.statusCode()).isEqualTo(200);
	}

}
