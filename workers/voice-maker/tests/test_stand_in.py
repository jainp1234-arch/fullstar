from voice_maker.mp3 import encode
from voice_maker.narrate import Narrator
from voice_maker.stand_in import WORD_S, StandInAligner, StandInVoice
from voice_maker.text import tokens

PAGE = "Rain falls down. The pond is full."


def test_every_word_gets_its_own_time_in_order():
    narration = Narrator(StandInVoice(), StandInAligner()).page(PAGE, "en")
    assert [t["w"] for t in narration.word_timings] == tokens(PAGE)
    starts = [t["start_ms"] for t in narration.word_timings]
    assert starts == sorted(starts)
    first = narration.word_timings[0]
    assert 0 < first["end_ms"] - first["start_ms"] <= WORD_S * 1000
    assert encode(narration.samples, narration.rate)[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3")


def test_a_lesson_gets_scene_times():
    narration = Narrator(StandInVoice(), StandInAligner()).lesson(
        [{"id": "s1", "text": "A bird builds a nest.", "lang": "en"}]
    )
    assert narration.scenes[0]["id"] == "s1"
    assert narration.scenes[0]["end_ms"] > narration.scenes[0]["start_ms"]
