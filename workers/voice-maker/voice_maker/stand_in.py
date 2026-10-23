"""Plan 9.5: a voice for the journey tests, without the 3.75 GB model.

Silence, 0.4 s a word, and an aligner that hears every word where it was "said". The worker, its
jobs, the MP3s and the timings are the real ones; only the speech is missing. The real voice is
tested on its own in the image (tests/test_image.py).
"""

from __future__ import annotations

import numpy as np

from .align import HeardWord

RATE = 16000
WORD_S = 0.4


class StandInVoice:
    rate = RATE

    def speak(self, text: str, lang: str) -> np.ndarray:
        return np.zeros(max(1, len(text.split())) * int(WORD_S * RATE), dtype=np.float32)


class StandInAligner:
    """Hears the prompt's words one after another, each in its own 0.4 s."""

    def words(self, wav: bytes, lang: str, prompt: str) -> list[HeardWord]:
        return [
            HeardWord(word, i * WORD_S + 0.05, (i + 1) * WORD_S - 0.05)
            for i, word in enumerate(prompt.split())
        ]
