package com.fullstar.bookreader.narrate;

/**
 * Silent MP3 audio of a given length, written frame by frame (Plan 5.4 stand-in): MPEG-1 Layer III,
 * 32 kbit/s, 44.1 kHz, mono. A frame whose side information and main data are all zero decodes to
 * silence, so no encoder is needed.
 */
final class SilentMp3 {

	/** 1152 samples at 44.1 kHz. */
	static final double FRAME_MS = 1152 * 1000.0 / 44_100;

	/** 144 × 32000 / 44100, no padding. */
	static final int FRAME_BYTES = 104;

	/** Sync, MPEG-1, Layer III, no CRC | 32 kbit/s, 44.1 kHz, no padding | mono. */
	private static final byte[] HEADER = { (byte) 0xFF, (byte) 0xFB, (byte) 0x10, (byte) 0xC0 };

	private SilentMp3() {
	}

	/** At least durationMs of silence (whole frames). */
	static byte[] of(long durationMs) {
		int frames = (int) Math.max(1, Math.ceil(durationMs / FRAME_MS));
		byte[] out = new byte[frames * FRAME_BYTES];
		for (int f = 0; f < frames; f++) {
			System.arraycopy(HEADER, 0, out, f * FRAME_BYTES, HEADER.length);
		}
		return out;
	}

}
