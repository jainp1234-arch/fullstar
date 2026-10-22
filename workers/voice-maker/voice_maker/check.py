"""Manual check (Plan 8.2 done-when): narrates every page text in a folder for you to listen to.

Put each page's text in a .txt file (Hindi is detected from Devanagari). For each, this writes
<name>.mp3 and <name>.labels.txt, the word timings as Audacity labels. In Audacity open the MP3,
then File > Import > Labels: each word should sit on its sound within 150 ms.
Run: python -m voice_maker.check DIR
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from .models import narrator_from_env
from .mp3 import encode

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def labels(word_timings: list[dict[str, object]]) -> str:
    """Audacity label track: start and end in seconds, then the word, tab-separated."""
    return "".join(
        f"{float(str(t['start_ms'])) / 1000:.3f}\t{float(str(t['end_ms'])) / 1000:.3f}\t{t['w']}\n"
        for t in word_timings
    )


def main(folder: str) -> int:
    root = Path(folder)
    pages = sorted(
        p for p in root.iterdir() if p.suffix.lower() == ".txt" and ".labels" not in p.name
    )
    if not pages:
        print(f"No .txt pages in {root}")
        return 1
    narrator = narrator_from_env()
    for page in pages:
        text = page.read_text(encoding="utf-8")
        lang = "hi" if _DEVANAGARI.search(text) else "en"
        narration = narrator.page(text, lang)
        page.with_suffix(".mp3").write_bytes(encode(narration.samples, narration.rate))
        page.with_name(page.stem + ".labels.txt").write_text(
            labels(narration.word_timings), encoding="utf-8"
        )
        seconds = narration.samples.size / narration.rate
        print(f"{page.name:<24} {lang}  {len(narration.word_timings):>4} words  {seconds:6.1f} s")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m voice_maker.check DIR")
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
