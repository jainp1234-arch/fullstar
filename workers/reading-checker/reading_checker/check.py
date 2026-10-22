"""Manual check (Plan 8.3 done-when): scores every recording in a folder against its passage.

Put each recording next to a text file with the same name holding the passage, e.g. kite.m4a and
kite.txt. Hindi is detected from Devanagari in the passage. Run: python -m reading_checker.check DIR
and compare accuracy with your own count (words read correctly / words in the passage x 100).
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from .recognizer import WhisperRecognizer
from .scoring import score, words

AUDIO = {".webm", ".m4a", ".mp4", ".ogg", ".mp3", ".wav"}
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def main(folder: str) -> int:
    root = Path(folder)
    recordings = sorted(p for p in root.iterdir() if p.suffix.lower() in AUDIO)
    if not recordings:
        print(f"No recordings in {root}")
        return 1
    recognizer = WhisperRecognizer(
        os.environ.get("WHISPER_MODEL_DIR", "/models/small"),
        int(os.environ.get("WHISPER_THREADS", "2")),
    )
    header = ("recording", "outcome", "accuracy %", "words/min", "read")
    print(
        f"{header[0]:<24} {header[1]:<15} {header[2]:>10} {header[3]:>10} {header[4]:>9}  practise"
    )
    for audio in recordings:
        passage = audio.with_suffix(".txt")
        if not passage.exists():
            print(f"{audio.name:<24} missing {passage.name}")
            continue
        text = passage.read_text(encoding="utf-8")
        lang = "hi" if _DEVANAGARI.search(text) else "en"
        result = score(text, recognizer.words(audio, lang))
        accuracy = "-" if result.accuracy_pct is None else f"{result.accuracy_pct:.1f}"
        wpm = "-" if result.words_per_minute is None else f"{result.words_per_minute:.1f}"
        read = f"{result.words_read}/{len(words(text))}"
        practise = ", ".join(result.words_to_practise)
        print(
            f"{audio.name:<24} {result.outcome:<15} {accuracy:>10} {wpm:>10} {read:>9}  {practise}"
        )
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m reading_checker.check DIR")
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
