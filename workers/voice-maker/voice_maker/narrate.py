"""Narration of a read-along page (audio + word timings) and of a lesson (audio + scene times)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .align import Aligner, place, wav_bytes
from .mp3 import silence
from .speech import Voice
from .text import chunks, tokens

#: Silence before the first word, between sentences, and between lesson scenes.
LEAD_S = 0.3
SENTENCE_GAP_S = 0.35
SCENE_GAP_S = 0.6
#: A page without words still gets a short silent file, so the chapter can be ready.
EMPTY_S = 1.0


@dataclass(frozen=True)
class PageNarration:
    samples: np.ndarray
    rate: int
    word_timings: list[dict[str, object]]


@dataclass(frozen=True)
class LessonNarration:
    samples: np.ndarray
    rate: int
    scenes: list[dict[str, object]]


def _ms(seconds: float) -> int:
    return round(seconds * 1000)


class Narrator:
    def __init__(self, voice: Voice, aligner: Aligner) -> None:
        self._voice = voice
        self._aligner = aligner

    def page(self, text: str, lang: str) -> PageNarration:
        rate = self._voice.rate
        words = tokens(text)
        if not words:
            return PageNarration(silence(EMPTY_S, rate), rate, [])
        pieces = [silence(LEAD_S, rate)]
        at = LEAD_S
        timings: list[dict[str, object]] = []
        for part in chunks(words):
            said = [words[i] for i in part]
            clip = self._voice.speak(" ".join(said), lang)
            length = clip.size / rate
            heard = self._aligner.words(wav_bytes(clip, rate), lang, " ".join(said))
            for word, (start, end) in zip(said, place(said, heard, length), strict=True):
                timings.append({"w": word, "start_ms": _ms(at + start), "end_ms": _ms(at + end)})
            pieces += [clip, silence(SENTENCE_GAP_S, rate)]
            at += length + SENTENCE_GAP_S
        return PageNarration(np.concatenate(pieces), rate, timings)

    def lesson(self, scenes: list[dict[str, str]]) -> LessonNarration:
        """Scenes in order, each {id, text, lang}; the times say where each scene's voice is."""
        rate = self._voice.rate
        pieces = [silence(LEAD_S, rate)]
        at = LEAD_S
        out: list[dict[str, object]] = []
        for scene in scenes:
            words = tokens(scene["text"])
            start = at
            for part in chunks(words):
                clip = self._voice.speak(" ".join(words[i] for i in part), scene["lang"])
                pieces += [clip, silence(SENTENCE_GAP_S, rate)]
                at += clip.size / rate + SENTENCE_GAP_S
            # The scene ends where its voice does, not after the pause that follows it
            end = max(start, at - SENTENCE_GAP_S)
            out.append({"id": scene["id"], "start_ms": _ms(start), "end_ms": _ms(end)})
            pieces.append(silence(SCENE_GAP_S, rate))
            at += SCENE_GAP_S
        return LessonNarration(np.concatenate(pieces), rate, out)
