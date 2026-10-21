package com.fullstar.bookreader.scan;

import com.fullstar.bookreader.config.ReaderProperties;
import com.fullstar.bookreader.jobs.JobEnvelope;
import com.fullstar.bookreader.jobs.JobHandler;
import com.fullstar.bookreader.resilience.ResilientCalls;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The upload-scan job (Schema §12; Plan 5.2): streams every uploaded file from storage to ClamAV.
 * Result { files: [{object_key, result: clean | infected, signature}], infected }. The API rejects
 * an upload with any infected file and sends the rest on to book-process.
 */
@Component
public class UploadScanHandler implements JobHandler {

	private static final Logger log = LoggerFactory.getLogger(UploadScanHandler.class);

	private final S3Client s3;

	private final ClamdClient clamd;

	private final ResilientCalls calls;

	private final JsonMapper json;

	private final String bucket;

	public UploadScanHandler(S3Client s3, ClamdClient clamd, ResilientCalls calls, JsonMapper json,
			ReaderProperties properties) {
		this.s3 = s3;
		this.clamd = clamd;
		this.calls = calls;
		this.json = json;
		this.bucket = properties.storage().bucket();
	}

	@Override
	public String queue() {
		return "upload-scan";
	}

	@Override
	public String type() {
		return "upload.scan";
	}

	@Override
	public JsonNode handle(JobEnvelope job) {
		List<Map<String, Object>> files = new ArrayList<>();
		boolean infected = false;
		for (JsonNode keyNode : job.payload().path("object_keys")) {
			String key = keyNode.asString();
			ClamdClient.Verdict verdict = calls.call(ResilientCalls.CLAMAV, () -> scan(key));
			Map<String, Object> file = new LinkedHashMap<>();
			file.put("object_key", key);
			file.put("result", verdict.infected() ? "infected" : "clean");
			file.put("signature", verdict.signature());
			files.add(file);
			infected |= verdict.infected();
		}
		if (files.isEmpty()) {
			throw new IllegalArgumentException("upload.scan without object_keys");
		}
		log.atInfo()
			.addKeyValue("upload_id", job.payload().path("upload_id").asString())
			.addKeyValue("files", files.size())
			.addKeyValue("infected", infected)
			.log("Upload scanned");
		return json.valueToTree(Map.of("files", files, "infected", infected));
	}

	/** One try: open the object and stream it to clamd (retried as a whole by the caller). */
	private ClamdClient.Verdict scan(String key) {
		try (ResponseInputStream<GetObjectResponse> object = s3.getObject(get -> get.bucket(bucket).key(key))) {
			return clamd.scan(object);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

}
