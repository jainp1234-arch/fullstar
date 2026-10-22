"""Text to speech: Indic Parler-TTS on the CPU (Tech Stack; Plan 8.2).

The voices are the model card's recommended speakers, chosen on 22 Oct 2026: Divya for Hindi and
Mary for English, asked for calm and a little slow for Class 3 readers. Each piece is generated
from a fixed seed, so the same text always sounds the same.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

DESCRIPTIONS = {
    "hi": (
        "Divya's voice is calm and clear, with a slightly slow pace and a moderate pitch. "
        "The recording is of very high quality, with no background noise."
    ),
    "en": (
        "Mary's voice is calm and clear, with a slightly slow pace and a moderate pitch. "
        "The recording is of very high quality, with no background noise."
    ),
}
SEED = 7
#: Quieter than this (about -40 dB) counts as silence when trimming a clip's ends.
SILENCE = 0.01


class Voice(Protocol):
    rate: int

    def speak(self, text: str, lang: str) -> np.ndarray: ...


class ParlerVoice:
    """Loads the model once from local files; nothing is fetched at run time."""

    def __init__(self, model_dir: str, description_tokenizer_dir: str, threads: int) -> None:
        import torch
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer

        torch.set_num_threads(threads)
        self._torch = torch
        self._model = ParlerTTSForConditionalGeneration.from_pretrained(model_dir).eval()
        self._prompts = AutoTokenizer.from_pretrained(model_dir)
        descriptions = AutoTokenizer.from_pretrained(description_tokenizer_dir)
        self._descriptions = {
            lang: descriptions(text, return_tensors="pt") for lang, text in DESCRIPTIONS.items()
        }
        self.rate = int(self._model.config.sampling_rate)

    def speak(self, text: str, lang: str) -> np.ndarray:
        description = self._descriptions[lang]
        prompt = self._prompts(text, return_tensors="pt")
        self._torch.manual_seed(SEED)
        with self._torch.inference_mode():
            generation = self._model.generate(
                input_ids=description.input_ids,
                attention_mask=description.attention_mask,
                prompt_input_ids=prompt.input_ids,
                prompt_attention_mask=prompt.attention_mask,
            )
        return trim(generation.cpu().numpy().squeeze().astype(np.float32), self.rate)


def trim(samples: np.ndarray, rate: int, keep_s: float = 0.05) -> np.ndarray:
    """Drops silence at both ends, keeping keep_s of it."""
    loud = np.flatnonzero(np.abs(samples) > SILENCE)
    if loud.size == 0:
        return samples[:0]
    keep = int(keep_s * rate)
    return samples[max(0, loud[0] - keep) : min(samples.size, loud[-1] + keep + 1)]
