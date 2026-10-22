"""Plan 8.2 in the image: the real voice narrates an English and a Hindi page.

The narration is heard again by Whisper from the MP3 the browser gets: most words must come back,
and every word's time must fall inside the audio, in order. The ±150 ms check against your own ears
is the manual check (make narrate-check DIR=).
"""

import io
import os

import pytest
from voice_maker.align import WhisperAligner, matches
from voice_maker.models import narrator_from_env
from voice_maker.mp3 import encode
from voice_maker.text import key, tokens

pytestmark = pytest.mark.image

PAGES = {
    "en": "Ravi has a red kite. On Sunday, he goes to the park with his sister Asha.",
    "hi": "मीरा खिड़की खोलती है और बाहर देखती है। पेड़ हवा में नाचते हैं।",
}


@pytest.fixture(scope="module")
def narrator():
    return narrator_from_env()


@pytest.fixture(scope="module")
def listener():
    return WhisperAligner(
        os.environ["WHISPER_MODEL_DIR"], int(os.environ.get("VOICE_THREADS", "4"))
    )


@pytest.mark.parametrize("lang", ["en", "hi"])
def test_a_page_is_narrated_with_a_time_for_every_word(narrator, listener, lang):
    text = PAGES[lang]
    narration = narrator.page(text, lang)
    mp3 = encode(narration.samples, narration.rate)
    length_ms = 1000 * narration.samples.size / narration.rate
    words = tokens(text)

    assert [t["w"] for t in narration.word_timings] == words
    starts = [t["start_ms"] for t in narration.word_timings]
    assert starts == sorted(starts)
    assert all(0 <= t["start_ms"] <= t["end_ms"] <= length_ms for t in narration.word_timings)
    # A calm voice: between 0.2 and 1.2 seconds a word
    assert 200 * len(words) <= length_ms <= 1200 * len(words) + 1000

    heard = listener.words(mp3_to_wav(mp3), lang, "")
    found = matches([key(w) for w in words], [key(w.text) for w in heard if key(w.text)])
    assert len(found) >= 0.7 * len(words), [w.text for w in heard]


def mp3_to_wav(mp3: bytes) -> bytes:
    """What the browser decodes, as 16 kHz WAV for the listener."""
    import av
    import numpy as np
    from voice_maker.align import wav_bytes

    with av.open(io.BytesIO(mp3)) as container:
        resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
        chunks = [
            out.to_ndarray().reshape(-1)
            for frame in container.decode(audio=0)
            for out in resampler.resample(frame)
        ]
    return wav_bytes(np.concatenate(chunks), 16000)
