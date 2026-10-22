import numpy as np
from voice_maker.align import HeardWord

RATE = 8000  # a rate MP3 supports


class FakeVoice:
    """One second of sound per word."""

    rate = RATE

    def __init__(self) -> None:
        self.said: list[tuple[str, str]] = []

    def speak(self, text: str, lang: str) -> np.ndarray:
        self.said.append((text, lang))
        return np.full(len(text.split()) * RATE, 0.5, dtype=np.float32)


class FakeAligner:
    """Hears every word but the ones in deaf, in the middle of its second."""

    def __init__(self, deaf: set[str] | None = None) -> None:
        self.deaf = deaf or set()
        self.prompts: list[str] = []

    def words(self, wav: bytes, lang: str, prompt: str) -> list[HeardWord]:
        assert wav[:4] == b"RIFF"
        self.prompts.append(prompt)
        return [
            HeardWord(w, i + 0.2, i + 0.8)
            for i, w in enumerate(prompt.split())
            if w not in self.deaf
        ]
