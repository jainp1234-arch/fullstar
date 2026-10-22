"""Speech to words with timings: faster-whisper, CPU, int8 (Tech Stack: model "small")."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .scoring import SpokenWord


class Recognizer(Protocol):
    def words(self, audio: Path, lang: str) -> list[SpokenWord]: ...


class WhisperRecognizer:
    """Loads the model once; lang is the passage's (en | hi). No prompt, so nothing is guessed."""

    def __init__(self, model_dir: str, threads: int) -> None:
        from faster_whisper import WhisperModel

        self._model = WhisperModel(
            model_dir, device="cpu", compute_type="int8", cpu_threads=threads
        )

    def words(self, audio: Path, lang: str) -> list[SpokenWord]:
        segments, _info = self._model.transcribe(
            str(audio),
            language=lang,
            beam_size=1,
            vad_filter=True,
            word_timestamps=True,
            condition_on_previous_text=False,
        )
        return [
            SpokenWord(word.word, float(word.start), float(word.end))
            for segment in segments
            for word in (segment.words or [])
        ]
