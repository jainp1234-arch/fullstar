package com.fullstar.bookreader;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** Plan 5.4: the read-along stand-in on ElasticMQ and SeaweedFS. */
class ReadAlongFlowTest extends TestCloud {

	@Test
	void everyPageGetsSilentAudioAndWordTimings() {
		String familyId = UUID.randomUUID().toString();
		String chapterId = UUID.randomUUID().toString();
		String runId = UUID.randomUUID().toString();
		String dir = "families/" + familyId + "/chapters/" + chapterId + "/narration-" + runId;
		String first = UUID.randomUUID().toString();
		String second = UUID.randomUUID().toString();
		putAt(dir + "-input.json", json.writeValueAsBytes(Map.of("pages",
				List.of(Map.of("page_id", first, "text", "Plants need water and light."),
						Map.of("page_id", second, "text", "")))));
		String key = "readalong.narrate:" + chapterId + ":" + runId;
		send("readalong-narrate", envelope("readalong.narrate", key, Map.of("family_chapter_id", chapterId,
				"family_id", familyId, "run_id", runId, "lang", "en", "page_count", 2, "pages_key", dir + "-input.json")));

		JsonNode payload = resultFor(key).path("payload");
		assertThat(payload.path("outcome").asString()).isEqualTo("success");
		assertThat(payload.path("result").path("result_key").asString()).isEqualTo(dir + "-result.json");
		JsonNode pages = json.readTree(get(dir + "-result.json")).path("pages");
		assertThat(pages).hasSize(2);
		assertThat(pages.get(0).path("audio_key").asString()).isEqualTo("families/" + familyId + "/audio/" + first + ".mp3");
		assertThat(pages.get(0).path("word_timings")).hasSize(5);
		assertThat(pages.get(0).path("word_timings").get(4).path("w").asString()).isEqualTo("light.");
		assertThat(pages.get(1).path("word_timings")).isEmpty();
		byte[] audio = get(pages.get(0).path("audio_key").asString());
		assertThat(audio[0]).isEqualTo((byte) 0xFF);
		assertThat(audio[1]).isEqualTo((byte) 0xFB);
	}

	@Test
	void aPagesFileOfAnotherChapterIsRefused() {
		String familyId = UUID.randomUUID().toString();
		String chapterId = UUID.randomUUID().toString();
		String runId = UUID.randomUUID().toString();
		String key = "readalong.narrate:" + chapterId + ":" + runId;
		send("readalong-narrate", envelope("readalong.narrate", key, Map.of("family_chapter_id", chapterId,
				"family_id", familyId, "run_id", runId, "lang", "en", "page_count", 1, "pages_key",
				"families/" + UUID.randomUUID() + "/chapters/x/narration-input.json")));
		assertThat(resultFor(key).path("payload").path("outcome").asString()).isEqualTo("failure");
	}

}
