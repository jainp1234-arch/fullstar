"""The real voice and aligner, from the model folders baked into the image."""

from __future__ import annotations

import os

from .narrate import Narrator


def narrator_from_env() -> Narrator:
    from .align import WhisperAligner
    from .speech import ParlerVoice

    threads = int(os.environ.get("VOICE_THREADS") or "4")
    voice = ParlerVoice(
        os.environ.get("VOICE_MODEL_DIR") or "/models/indic-parler-tts",
        os.environ.get("VOICE_DESCRIPTION_TOKENIZER_DIR") or "/models/flan-t5-large",
        threads,
    )
    aligner = WhisperAligner(
        os.environ.get("WHISPER_MODEL_DIR") or "/models/whisper-small", threads
    )
    return Narrator(voice, aligner)
