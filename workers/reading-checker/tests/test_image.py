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


def test_skipped_sentences_are_missed_and_to_practise(recognizer, tmp_path):
    # Skipping whole sentences keeps the speech natural: espeak-ng run together from broken
    # sentences is misheard far more than a child would be (CI, 22 Oct 2026)
    skipped = ["The wind is strong.", "It flies over the tall trees."]
    reading = PASSAGE
    for sentence in skipped:
        reading = reading.replace(sentence, "")
    result = score(PASSAGE, recognizer.words(speak(tmp_path, " ".join(reading.split())), "en"))
    assert result.outcome == "scored"
    words = len(PASSAGE.split())
    missed = sum(len(sentence.split()) for sentence in skipped)
    expected = 100 * (words - missed) / words
    # Synthetic speech is less clear than a child's: twice the ±5% of the manual check (Plan 8.3)
    assert abs(result.accuracy_pct - expected) <= 10
    assert {"wind", "strong"} & set(result.words_to_practise)


def test_silence_and_another_text_are_not_understood(recognizer, tmp_path):
    assert score(PASSAGE, recognizer.words(silence(tmp_path, 5), "en")).outcome == "not_understood"
    other = speak(tmp_path, "Today we are going to cook rice and dal for dinner at home.")
    assert score(PASSAGE, recognizer.words(other, "en")).outcome == "not_understood"


def test_hindi_is_recognised_in_devanagari(recognizer, tmp_path):
    # espeak-ng's Hindi voice is too unlike speech for the model to score (CI, 22 Oct 2026), so
    # Hindi accuracy is the user's manual check (Plan 8.3); here the Hindi path runs end to end
    passage = "मीरा खिड़की खोलती है और बाहर देखती है। पेड़ हवा में नाचते हैं।"
    result = score(passage, recognizer.words(speak(tmp_path, passage, voice="hi"), "hi"))
    assert result.word_count == 13
    assert any("ऀ" <= ch <= "ॿ" for ch in result.transcript)
