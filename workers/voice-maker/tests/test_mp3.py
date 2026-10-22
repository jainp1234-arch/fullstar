import io

import av
import numpy as np
from voice_maker.mp3 import encode


def test_encodes_mono_mp3_of_the_same_length():
    rate = 44100
    tone = 0.3 * np.sin(2 * np.pi * 440 * np.arange(2 * rate) / rate).astype(np.float32)
    data = encode(tone, rate)
    with av.open(io.BytesIO(data)) as container:
        stream = container.streams.audio[0]
        assert stream.codec_context.name in {"mp3", "mp3float"}
        assert stream.codec_context.channels == 1
        decoded = sum(frame.samples for frame in container.decode(stream))
    # MP3 pads to whole frames (1152 samples) plus the encoder delay
    assert abs(decoded - tone.size) < 3 * 1152
