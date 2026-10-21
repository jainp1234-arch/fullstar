package com.fullstar.bookreader.narrate;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Plan 5.4: the stand-in's silent audio and evenly spaced word timings. */
class SilentMp3Test {

	@Test
	void silenceIsWholeMpegFramesCoveringTheDuration() {
		byte[] audio = SilentMp3.of(2_000);
		int frames = audio.length / SilentMp3.FRAME_BYTES;
		assertThat(audio.length % SilentMp3.FRAME_BYTES).isZero();
		assertThat(frames * SilentMp3.FRAME_MS).isGreaterThanOrEqualTo(2_000).isLessThan(2_000 + SilentMp3.FRAME_MS);
		for (int f = 0; f < frames; f++) {
			int at = f * SilentMp3.FRAME_BYTES;
			assertThat(new byte[] { audio[at], audio[at + 1], audio[at + 2], audio[at + 3] })
				.containsExactly(0xFF, 0xFB, 0x10, 0xC0);
		}
		assertThat(SilentMp3.of(0)).hasSize(SilentMp3.FRAME_BYTES);
	}

	@Test
	void wordsAreSpacedEvenlyAndKeepTheirText() {
		List<Map<String, Object>> timings = ReadAlongStandIn.timings("  The bird\nsings.  चिड़िया गाती है ");
		assertThat(timings).extracting(t -> t.get("w")).containsExactly("The", "bird", "sings.", "चिड़िया", "गाती", "है");
		assertThat(timings.get(0)).containsEntry("start_ms", 300L).containsEntry("end_ms", 620L);
		assertThat(timings.get(5)).containsEntry("start_ms", 2_300L).containsEntry("end_ms", 2_620L);
		assertThat(ReadAlongStandIn.timings("   ")).isEmpty();
	}

}
