"""Page text as read-along (K5) shows it, and the pieces the voice says in one go.

K5 highlights the words of word_timings in order, so the words are the page text split on white
space, exactly like the 5.4 stand-in. The voice is given one sentence at a time (a long sentence is
cut at a comma, or after MAX_CHUNK_WORDS words): Parler-TTS stays steady on short inputs.
"""

from __future__ import annotations

import re
import unicodedata

MAX_CHUNK_WORDS = 24

_SENTENCE_END = re.compile("[.!?।॥][\"'”’)\\]]*$")
_PAUSE = re.compile("[,;:—–][\"'”’)\\]]*$")
# Letters and marks of any script (Devanagari vowel signs are marks), digits; not the danda (।, ॥)
_LETTERS = re.compile("[\\wऀ-ॣ०-ॿ]+", re.UNICODE)


def tokens(text: str) -> list[str]:
    """The words K5 shows: the page text split on white space, NFC-normalised."""
    return unicodedata.normalize("NFC", text).split()


def key(token: str) -> str:
    """What a word sounds like for matching: its letters, case and punctuation ignored."""
    return "".join(_LETTERS.findall(unicodedata.normalize("NFC", token))).casefold()


def chunks(words: list[str]) -> list[range]:
    """Consecutive ranges of word indexes, each a sentence or part of a long one."""
    out: list[range] = []
    start = 0
    pause = -1
    for i, word in enumerate(words):
        if _PAUSE.search(word):
            pause = i
        if _SENTENCE_END.search(word) or i == len(words) - 1:
            out.append(range(start, i + 1))
            start, pause = i + 1, -1
        elif i + 1 - start >= MAX_CHUNK_WORDS:
            # Cut at the last comma in the second half of the piece, else right here
            cut = pause + 1 if pause >= start + MAX_CHUNK_WORDS // 2 else i + 1
            out.append(range(start, cut))
            start, pause = cut, -1
    return out
