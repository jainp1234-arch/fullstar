package com.fullstar.bookreader;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.bookreader.jobs.JobWorkers;
import com.fullstar.bookreader.scan.FakeClamd;
import com.fullstar.bookreader.scan.UploadScanHandler;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

/** Plan 5.2: upload-scan on real ElasticMQ and SeaweedFS, with a stand-in clamd. */
class UploadScanFlowTest extends TestCloud {

	@Autowired
	private JobWorkers workers;

	@Autowired
	private UploadScanHandler handler;

	@AfterEach
	void normalClamd() {
		CLAMD.reply(null);
	}

	private String put(String content) {
		return put(content.getBytes(StandardCharsets.ISO_8859_1));
	}

	private String job(String key, List<String> objectKeys) {
		return envelope("upload.scan", key, Map.of("upload_id", UUID.randomUUID().toString(), "object_keys", objectKeys));
	}

	@Test
	void aCleanUploadIsReportedCleanAndTheJobIsDeleted() {
		String key = "upload.scan:" + UUID.randomUUID();
		send("upload-scan", job(key, List.of(put("%PDF-1.7 a clean page"))));

		JsonNode envelope = resultFor(key);
		assertThat(envelope.path("type").asString()).isEqualTo("job.result");
		JsonNode payload = envelope.path("payload");
		assertThat(payload.path("type").asString()).isEqualTo("upload.scan");
		assertThat(payload.path("outcome").asString()).isEqualTo("success");
		assertThat(payload.path("result").path("infected").asBoolean()).isFalse();
		assertThat(payload.path("result").path("files").get(0).path("result").asString()).isEqualTo("clean");
		String url = sqs.getQueueUrl(r -> r.queueName("upload-scan")).queueUrl();
		assertThat(sqs.receiveMessage(r -> r.queueUrl(url).waitTimeSeconds(1)).messages()).isEmpty();
	}

	@Test
	void theEicarTestFileIsReportedInfected() {
		String key = "upload.scan:" + UUID.randomUUID();
		send("upload-scan", job(key, List.of(put("a clean photo"), put(FakeClamd.EICAR))));

		JsonNode result = resultFor(key).path("payload").path("result");
		assertThat(result.path("infected").asBoolean()).isTrue();
		assertThat(result.path("files").get(0).path("result").asString()).isEqualTo("clean");
		assertThat(result.path("files").get(1).path("result").asString()).isEqualTo("infected");
		assertThat(result.path("files").get(1).path("signature").asString()).isEqualTo("Eicar-Test-Signature");
	}

	@Test
	void aScanThatKeepsFailingIsRetriedThenReportedAsAFailure() {
		CLAMD.reply("INSTREAM size limit exceeded. ERROR");
		String key = "upload.scan:" + UUID.randomUUID();
		String body = job(key, List.of(put("pages")));
		assertThat(workers.process(handler, body, 1)).isEqualTo(JobWorkers.Outcome.RETRY);
		assertThat(workers.process(handler, body, JobWorkers.MAX_RECEIVES)).isEqualTo(JobWorkers.Outcome.FAILURE);
		JsonNode payload = resultFor(key).path("payload");
		assertThat(payload.path("outcome").asString()).isEqualTo("failure");
		assertThat(payload.path("error").path("code").asString()).isEqualTo("WORKER_FAILED");
	}

}
