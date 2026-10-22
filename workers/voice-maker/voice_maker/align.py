"""Word timings for generated speech (Plan 8.2, decided 22 Oct 2026).

faster-whisper hears the speech with word timestamps; its words are matched to the page's words in
order (the longest common subsequence, near spellings at 0.8 like the reading check). A page word
it heard gets the heard times; the words between two heard ones share the gap by their length.
"""

from __future__ import annotations

import difflib
import io
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .text import key

NEAR_MATCH = 0.8


@dataclass(frozen=True)
class HeardWord:
    text: str
    start: float
    end: float


class Aligner(Protocol):
    def words(self, wav: bytes, lang: str, prompt: str) -> list[HeardWord]: ...


class WhisperAligner:
    """faster-whisper small, CPU int8; the text the voice was given steers the spelling."""

    def __init__(self, model_dir: str, threads: int) -> None:
        from faster_whisper import WhisperModel

        self._model = WhisperModel(
            model_dir, device="cpu", compute_type="int8", cpu_threads=threads
        )

    def words(self, wav: bytes, lang: str, prompt: str) -> list[HeardWord]:
        segments, _info = self._model.transcribe(
            io.BytesIO(wav),
            language=lang,
            beam_size=1,
            word_timestamps=True,
            condition_on_previous_text=False,
            initial_prompt=prompt,
        )
        return [
            HeardWord(word.word, float(word.start), float(word.end))
            for segment in segments
            for word in (segment.words or [])
        ]


def _same(a: str, b: str) -> bool:
    return a == b or difflib.SequenceMatcher(None, a, b).ratio() >= NEAR_MATCH


def matches(page: list[str], heard: list[str]) -> list[tuple[int, int]]:
    """(page index, heard index) pairs of the longest common subsequence; empty keys never match."""
    rows, cols = len(page), len(heard)
    table = [[0] * (cols + 1) for _ in range(rows + 1)]
    for i in range(rows - 1, -1, -1):
        for j in range(cols - 1, -1, -1):
            if page[i] and heard[j] and _same(page[i], heard[j]):
                table[i][j] = table[i + 1][j + 1] + 1
            else:
                table[i][j] = max(table[i + 1][j], table[i][j + 1])
    found: list[tuple[int, int]] = []
    i = j = 0
    while i < rows and j < cols:
        if (
            page[i]
            and heard[j]
            and _same(page[i], heard[j])
            and table[i][j] == table[i + 1][j + 1] + 1
        ):
            found.append((i, j))
            i += 1
            j += 1
        elif table[i + 1][j] >= table[i][j + 1]:
            i += 1
        else:
            j += 1
    return found


def place(words: list[str], heard: list[HeardWord], length_s: float) -> list[tuple[float, float]]:
    """Start and end (seconds into the clip) of each word, in order and inside 0..length_s."""
    if not words:
        return []
    # Whisper words split on spaces like the page's; punctuation alone is dropped
    parts = [(key(w.text), w) for w in heard if key(w.text)]
    pairs = matches([key(w) for w in words], [k for k, _w in parts])
    times: list[tuple[float, float] | None] = [None] * len(words)
    for i, j in pairs:
        word = parts[j][1]
        times[i] = (max(0.0, min(word.start, length_s)), max(0.0, min(word.end, length_s)))
    out: list[tuple[float, float]] = []
    i = 0
    while i < len(words):
        known = times[i]
        if known is not None:
            start = max(known[0], out[-1][1] if out else 0.0)
            out.append((start, max(start, known[1])))
            i += 1
            continue
        # A run of words not heard: they share the time between their heard neighbours
        end = i
        while end < len(words) and times[end] is None:
            end += 1
        gap_start = out[-1][1] if out else 0.0
        following = times[end] if end < len(words) else None
        gap_end = max(gap_start, following[0] if following else length_s)
        weights = [max(1, len(key(w))) for w in words[i:end]]
        total = sum(weights)
        at = gap_start
        for weight in weights:
            step = (gap_end - gap_start) * weight / total
            out.append((at, at + step))
            at += step
        i = end
    return out


def wav_bytes(samples: np.ndarray, rate: int) -> bytes:
    """16-bit mono WAV of float samples in -1..1, for the recogniser."""
    import wave

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm)
    return buffer.getvalue()
