"""Reading score from recognised words (Schema §12 reading-score; Plan 8.3, decided 22 Oct 2026).

Accuracy is the share of the passage's words read, in order; words per minute counts those words
over the time from the first to the last spoken word. A recording is "not understood" when it has
under 3 seconds of speech, no words, or fewer than 30% of the passage's words in order.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass

MIN_SPEECH_S = 3.0
MIN_MATCHED_SHARE = 0.30
#: Two spellings of a word count as the same when this close (Whisper spells Hindi loosely).
NEAR_MATCH = 0.8
MAX_PRACTISE = 5

# Letters and marks of any script (Devanagari vowel signs are marks), digits; not the danda (।, ॥)
_WORD = re.compile("[\\wऀ-ॣ०-ॿ]+", re.UNICODE)


@dataclass(frozen=True)
class SpokenWord:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Score:
    outcome: str  # "scored" | "not_understood"
    transcript: str
    accuracy_pct: float | None
    words_per_minute: float | None
    words_read: int
    word_count: int
    words_to_practise: list[str]

    def as_result(self) -> dict[str, object]:
        return {
            "outcome": self.outcome,
            "transcript": self.transcript,
            "accuracy_pct": self.accuracy_pct,
            "words_per_minute": self.words_per_minute,
            "words_read": self.words_read,
            "word_count": self.word_count,
            "words_to_practise": self.words_to_practise,
        }


def words(text: str) -> list[str]:
    """The words of a text as written (punctuation dropped), NFC-normalised."""
    return _WORD.findall(unicodedata.normalize("NFC", text))


def _key(word: str) -> str:
    return unicodedata.normalize("NFC", word).casefold()


def _same(a: str, b: str) -> bool:
    if a == b:
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= NEAR_MATCH


def matched_indexes(passage: list[str], spoken: list[str]) -> list[int]:
    """Indexes of passage words read in order: the longest common subsequence with near matches."""
    p = [_key(w) for w in passage]
    s = [_key(w) for w in spoken]
    rows, cols = len(p), len(s)
    table = [[0] * (cols + 1) for _ in range(rows + 1)]
    for i in range(rows - 1, -1, -1):
        for j in range(cols - 1, -1, -1):
            if _same(p[i], s[j]):
                table[i][j] = table[i + 1][j + 1] + 1
            else:
                table[i][j] = max(table[i + 1][j], table[i][j + 1])
    found: list[int] = []
    i = j = 0
    while i < rows and j < cols:
        if _same(p[i], s[j]) and table[i][j] == table[i + 1][j + 1] + 1:
            found.append(i)
            i += 1
            j += 1
        elif table[i + 1][j] >= table[i][j + 1]:
            i += 1
        else:
            j += 1
    return found


def score(passage_text: str, spoken: list[SpokenWord]) -> Score:
    passage = words(passage_text)
    heard = [w for w in spoken if words(w.text)]
    transcript = " ".join(w.text.strip() for w in heard)
    spoken_words = [part for w in heard for part in words(w.text)]
    speech_s = (heard[-1].end - heard[0].start) if heard else 0.0
    matched = matched_indexes(passage, spoken_words) if passage else []
    if (
        not passage
        or not spoken_words
        or speech_s < MIN_SPEECH_S
        or len(matched) < MIN_MATCHED_SHARE * len(passage)
    ):
        return Score("not_understood", transcript, None, None, 0, len(passage), [])
    read = set(matched)
    practise: list[str] = []
    for index, word in enumerate(passage):
        if index not in read and _key(word) not in {_key(w) for w in practise}:
            practise.append(word)
        if len(practise) == MAX_PRACTISE:
            break
    return Score(
        outcome="scored",
        transcript=transcript,
        accuracy_pct=round(100 * len(matched) / len(passage), 2),
        words_per_minute=round(len(matched) / (speech_s / 60), 2),
        words_read=len(matched),
        word_count=len(passage),
        words_to_practise=practise,
    )
