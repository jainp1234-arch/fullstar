"""MP3 for the browser: mono, 64 kbit/s, LAME from the PyAV wheel's FFmpeg."""

from __future__ import annotations

import io

import numpy as np

BIT_RATE = 64_000


def encode(samples: np.ndarray, rate: int) -> bytes:
    import av

    buffer = io.BytesIO()
    with av.open(buffer, mode="w", format="mp3") as container:
        stream = container.add_stream("libmp3lame", rate=rate, layout="mono")
        stream.bit_rate = BIT_RATE
        frame = av.AudioFrame.from_ndarray(
            np.clip(samples, -1.0, 1.0).astype(np.float32).reshape(1, -1),
            format="flt",
            layout="mono",
        )
        frame.sample_rate = rate
        # PyAV cuts the frame into the encoder's frame size; None flushes the rest
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    return buffer.getvalue()


def silence(seconds: float, rate: int) -> np.ndarray:
    return np.zeros(int(seconds * rate), dtype=np.float32)
