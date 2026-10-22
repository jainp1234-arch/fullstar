"""Plan 8.3 in the image: the real model scores synthetic speech (espeak-ng) whose gaps we know."""

import os
import subprocess
import wave
from pathlib import Path

import pytest
from reading_checker.recognizer import WhisperRecognizer
from reading_checker.scoring import score

pytestmark = pytest.mark.image

PASSAGE = (
    "Ravi has a red kite. On Sunday, he goes to the park with his sister Asha. The wind is "
    "strong. Ravi runs and the kite goes up, up, up. It flies over the tall trees."
)


@pytest.fixture(scope="module")
def recognizer() -> WhisperRecognizer:
    return WhisperRecognizer(os.environ["WHISPER_MODEL_DIR"], 2)


def speak(tmp_path: Path, text: str, voice: str = "en-us", name: str = "speech") -> Path:
    out = tmp_path / f"{name}.wav"
    subprocess.run(["espeak-ng", "-v", voice, "-s", "130", "-w", str(out), text], check=True)
    return out


def silence(tmp_path: Path, seconds: int) -> Path:
    out = tmp_path / "silence.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000 * seconds)
    return out


def test_a_full_reading_scores_high(recognizer, tmp_path):
    result = score(PASSAGE, recognizer.words(speak(tmp_path, PASSAGE), "en"))
    assert result.outcome == "scored"
    assert result.accuracy_pct >= 90
    assert 60 <= result.words_per_minute <= 200


def test_skipped_words_are_missed_and_to_practise(recognizer, tmp_path):
    words = PASSAGE.split()
    # Skip 8 of the 35 words: the expected accuracy is 27/35 = 77.1%
    skipped = {3, 4, 10, 11, 18, 19, 27, 28}
    reading = " ".join(w for i, w in enumerate(words) if i not in skipped)
    result = score(PASSAGE, recognizer.words(speak(tmp_path, reading), "en"))
    assert result.outcome == "scored"
    expected = 100 * (len(words) - len(skipped)) / len(words)
    # Plan 8.3 done-when is ±5% against a manual check; synthetic speech gets the same margin
    assert abs(result.accuracy_pct - expected) <= 5
    assert "red" in result.words_to_practise


def test_silence_and_another_text_are_not_understood(recognizer, tmp_path):
    assert score(PASSAGE, recognizer.words(silence(tmp_path, 5), "en")).outcome == "not_understood"
    other = speak(tmp_path, "Today we are going to cook rice and dal for dinner at home.")
    assert score(PASSAGE, recognizer.words(other, "en")).outcome == "not_understood"


def test_hindi_reading(recognizer, tmp_path):
    passage = "मीरा खिड़की खोलती है और बाहर देखती है। पेड़ हवा में नाचते हैं।"
    result = score(passage, recognizer.words(speak(tmp_path, passage, voice="hi"), "hi"))
    assert result.outcome == "scored"
    assert result.accuracy_pct >= 60
