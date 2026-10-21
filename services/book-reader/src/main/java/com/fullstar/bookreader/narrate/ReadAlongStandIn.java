package com.fullstar.bookreader.narrate;

import com.fullstar.bookreader.config.ReaderProperties;
import com.fullstar.bookreader.jobs.JobEnvelope;
import com.fullstar.bookreader.jobs.JobHandler;
import com.fullstar.bookreader.resilience.ResilientCalls;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Stand-in for the readalong-narrate job (Schema §12; Plan 5.4) until voice-maker reads pages aloud
 * (Plan 8.2, which removes this class). Each page gets silent MP3 audio at audio/&lt;page_id&gt;.mp3 and
 * word timings spaced evenly over it, so read-along (K5) can be built now. Input and result are files
 * in storage next to the chapter, named by the job.
 */
@Component
public class ReadAlongStandIn implements JobHandler {

	private static final Logger log = LoggerFactory.getLogger(ReadAlongStandIn.class);

	/** Silence before the first word and after the last. */
	static final int LEAD_MS = 300;

	/** One word every WORD_MS; each is highlighted for SPOKEN_MS of it. */
	static final int WORD_MS = 400;

	static final int SPOKEN_MS = 320;

	private final S3Client s3;

	private final ResilientCalls calls;

	private final JsonMapper json;

	private final String bucket;

	public ReadAlongStandIn(S3Client s3, ResilientCalls calls, JsonMapper json, ReaderProperties properties) {
		this.s3 = s3;
		this.calls = calls;
		this.json = json;
		this.bucket = properties.storage().bucket();
	}

	@Override
	public String queue() {
		return "readalong-narrate";
	}

	@Override
	public String type() {
		return "readalong.narrate";
	}

	@Override
	public JsonNode handle(JobEnvelope job) {
		JsonNode payload = job.payload();
		// UUIDs only: they become parts of storage keys
		UUID familyId = UUID.fromString(payload.path("family_id").asString());
		UUID chapterId = UUID.fromString(payload.path("family_chapter_id").asString());
		UUID runId = UUID.fromString(payload.path("run_id").asString());
		String chapterDir = "families/" + familyId + "/chapters/" + chapterId + "/narration-" + runId;
		String inputKey = payload.path("pages_key").asString();
		if (!inputKey.equals(chapterDir + "-input.json")) {
			throw new IllegalArgumentException("pages_key does not belong to the job");
		}
		JsonNode input = json.readTree(calls.call(ResilientCalls.R2,
				() -> s3.getObjectAsBytes(get -> get.bucket(bucket).key(inputKey)).asByteArray()));
		List<Map<String, Object>> pages = new ArrayList<>();
		for (JsonNode page : input.path("pages")) {
			UUID pageId = UUID.fromString(page.path("page_id").asString());
			List<Map<String, Object>> timings = timings(page.path("text").asString(""));
			long duration = timings.isEmpty() ? 1000
					: ((Number) timings.get(timings.size() - 1).get("end_ms")).longValue() + LEAD_MS;
			String audioKey = "families/" + familyId + "/audio/" + pageId + ".mp3";
			byte[] audio = SilentMp3.of(duration);
			calls.run(ResilientCalls.R2, () -> s3.putObject(
					put -> put.bucket(bucket).key(audioKey).contentType("audio/mpeg"), RequestBody.fromBytes(audio)));
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("page_id", pageId.toString());
			result.put("audio_key", audioKey);
			result.put("word_timings", timings);
			pages.add(result);
		}
		String resultKey = chapterDir + "-result.json";
		byte[] body = json.writeValueAsBytes(Map.of("pages", pages));
		calls.run(ResilientCalls.R2, () -> s3.putObject(
				put -> put.bucket(bucket).key(resultKey).contentType("application/json"), RequestBody.fromBytes(body)));
		log.atInfo().addKeyValue("family_chapter_id", chapterId).addKeyValue("pages", pages.size())
			.log("Read-along stand-in done");
		return json.valueToTree(Map.of("result_key", resultKey, "page_count", pages.size()));
	}

	/** Schema §4.3 word_timings: [{"w", "start_ms", "end_ms"}], one word every WORD_MS. */
	static List<Map<String, Object>> timings(String text) {
		List<Map<String, Object>> out = new ArrayList<>();
		int i = 0;
		for (String word : text.strip().split("\\s+")) {
			if (word.isEmpty()) {
				continue;
			}
			long start = LEAD_MS + (long) i * WORD_MS;
			Map<String, Object> timing = new LinkedHashMap<>();
			timing.put("w", word);
			timing.put("start_ms", start);
			timing.put("end_ms", start + SPOKEN_MS);
			out.add(timing);
			i++;
		}
		return out;
	}

}
