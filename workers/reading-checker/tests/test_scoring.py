from reading_checker.scoring import SpokenWord, matched_indexes, score, words

PASSAGE = "Ravi has a red kite. On Sunday, he goes to the park with his sister Asha."


def spoken(text: str, seconds_per_word: float = 0.5) -> list[SpokenWord]:
    return [
        SpokenWord(f" {w}", i * seconds_per_word, (i + 1) * seconds_per_word)
        for i, w in enumerate(text.split())
    ]


def test_words_drop_punctuation_and_keep_hindi_marks():
    assert words("Ravi has a red kite.") == ["Ravi", "has", "a", "red", "kite"]
    assert words("राम ने पानी पिया।") == ["राम", "ने", "पानी", "पिया"]


def test_a_full_reading_scores_100_percent_at_the_spoken_pace():
    result = score(PASSAGE, spoken(PASSAGE.replace(",", "").replace(".", "")))
    assert result.outcome == "scored"
    assert result.accuracy_pct == 100.0
    assert result.words_read == 16
    assert result.word_count == 16
    # 16 words in 8 seconds of speech
    assert result.words_per_minute == 120.0
    assert result.words_to_practise == []


def test_skipped_and_misread_words_lower_accuracy_and_are_to_practise():
    reading = "Ravi has a kite on Sunday he goes to the bark with his sister Asha"
    result = score(PASSAGE, spoken(reading))
    # "red" skipped, "park" read as "bark": 14 of 16
    assert result.accuracy_pct == 87.5
    assert result.words_to_practise == ["red", "park"]


def test_order_matters_and_near_spellings_count():
    # Read backwards, only one word is in order
    assert len(matched_indexes(["one", "two", "three"], ["three", "two", "one"])) == 1
    assert matched_indexes(["kite"], ["Kite"]) == [0]
    assert matched_indexes(["Sunday"], ["Sundays"]) == [0]


def test_words_to_practise_are_unique_and_at_most_five():
    passage = "a b c d e f g h a"
    result = score(passage, spoken("x " * 2 + "a b c", seconds_per_word=2))
    assert result.outcome == "scored"
    assert result.words_to_practise == ["d", "e", "f", "g", "h"]


def test_not_understood_without_enough_speech_or_matches():
    assert score(PASSAGE, []).outcome == "not_understood"
    # Under 3 seconds of speech
    short = score(PASSAGE, spoken("Ravi has a red kite on", seconds_per_word=0.4))
    assert short.outcome == "not_understood"
    # Long enough, but under 30% of the passage
    noise = score(PASSAGE, spoken("hello hello Ravi kite we are playing outside today now"))
    assert noise.outcome == "not_understood"
    assert noise.accuracy_pct is None
    assert noise.words_per_minute is None
    assert noise.words_to_practise == []


def test_hindi_reading():
    passage = "मीरा खिड़की खोलती है और बाहर देखती है।"
    result = score(passage, spoken("मीरा खिड़की खोलती है और बाहर देखती है"))
    assert result.accuracy_pct == 100.0
