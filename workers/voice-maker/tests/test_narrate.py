from voice_maker.narrate import EMPTY_S, LEAD_S, SCENE_GAP_S, SENTENCE_GAP_S, Narrator

from tests.fakes import RATE, FakeAligner, FakeVoice


def test_a_page_is_said_sentence_by_sentence_with_word_timings():
    voice = FakeVoice()
    narration = Narrator(voice, FakeAligner()).page("Ravi has a kite. It is red.", "en")
    assert voice.said == [("Ravi has a kite.", "en"), ("It is red.", "en")]
    first = [t for t in narration.word_timings][:4]
    assert first[0] == {"w": "Ravi", "start_ms": 500, "end_ms": 1100}
    assert first[3]["w"] == "kite."
    second_start = LEAD_S + 4 + SENTENCE_GAP_S
    assert narration.word_timings[4] == {
        "w": "It",
        "start_ms": round((second_start + 0.2) * 1000),
        "end_ms": round((second_start + 0.8) * 1000),
    }
    assert narration.samples.size == round(
        (LEAD_S + 4 + SENTENCE_GAP_S + 3 + SENTENCE_GAP_S) * RATE
    )


def test_words_not_heard_still_get_times_between_their_neighbours():
    narration = Narrator(FakeVoice(), FakeAligner({"has"})).page("Ravi has kite", "hi")
    ravi, has, kite = narration.word_timings
    assert ravi["end_ms"] == has["start_ms"]
    assert has["end_ms"] == kite["start_ms"]


def test_an_empty_page_is_a_short_silence():
    narration = Narrator(FakeVoice(), FakeAligner()).page("  ", "en")
    assert narration.word_timings == []
    assert narration.samples.size == EMPTY_S * RATE
    assert not narration.samples.any()


def test_a_lesson_gives_each_scene_its_part():
    voice = FakeVoice()
    narration = Narrator(voice, FakeAligner()).lesson(
        [
            {"id": "s1", "text": "A bird. It sings.", "lang": "en"},
            {"id": "s2", "text": "पेड़ है।", "lang": "hi"},
        ]
    )
    assert voice.said == [("A bird.", "en"), ("It sings.", "en"), ("पेड़ है।", "hi")]
    s1, s2 = narration.scenes
    assert s1 == {
        "id": "s1",
        "start_ms": 300,
        "end_ms": round((LEAD_S + 2 + SENTENCE_GAP_S + 2) * 1000),
    }
    assert s2["start_ms"] == round((LEAD_S + 4 + 2 * SENTENCE_GAP_S + SCENE_GAP_S) * 1000)
    assert s2["end_ms"] - s2["start_ms"] == 2000
