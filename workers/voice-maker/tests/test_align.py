import io
import wave

import numpy as np
from voice_maker.align import HeardWord, matches, place, wav_bytes


def heard(*items):
    return [HeardWord(text, start, end) for text, start, end in items]


def test_heard_words_keep_their_times():
    words = ["Ravi", "has", "a", "kite."]
    times = place(
        words,
        heard((" Ravi", 0.1, 0.4), (" has", 0.5, 0.7), (" a", 0.75, 0.8), (" kite.", 0.9, 1.3)),
        1.5,
    )
    assert times == [(0.1, 0.4), (0.5, 0.7), (0.75, 0.8), (0.9, 1.3)]


def test_unheard_words_share_the_gap_by_length():
    words = ["Ravi", "xx", "xxxx", "kite"]
    times = place(words, heard(("Ravi", 0.0, 0.5), ("kite", 1.1, 1.5)), 2.0)
    assert times[0] == (0.0, 0.5)
    assert np.allclose(times[1], (0.5, 0.7))
    assert np.allclose(times[2], (0.7, 1.1))
    assert times[3] == (1.1, 1.5)


def test_nothing_heard_spreads_the_words_over_the_clip():
    times = place(["one", "two"], [], 1.2)
    assert np.allclose(times, [(0.0, 0.6), (0.6, 1.2)])


def test_near_spellings_match_and_extra_heard_words_are_skipped():
    # khidki / khidaki are 0.92 alike; meera / mira only 0.67
    assert matches(["meera", "khidki"], ["um", "mira", "khidaki"]) == [(1, 2)]
    assert matches(["", "kite"], ["", "kite"]) == [(1, 1)]


def test_times_stay_in_order_and_inside_the_clip():
    words = ["a", "b", "c"]
    times = place(words, heard(("a", 0.5, 0.9), ("b", 0.3, 0.4), ("c", 1.0, 9.0)), 2.0)
    starts = [s for s, _e in times]
    assert starts == sorted(starts)
    assert all(s <= e <= 2.0 for s, e in times)


def test_wav_bytes_is_16_bit_mono():
    data = wav_bytes(np.array([0.0, 0.5, -1.0], dtype=np.float32), 16000)
    with wave.open(io.BytesIO(data)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (
            1,
            2,
            16000,
            3,
        )
