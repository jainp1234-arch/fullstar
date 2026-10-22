from voice_maker.text import MAX_CHUNK_WORDS, chunks, key, tokens


def test_tokens_are_the_words_k5_shows():
    assert tokens("  Ravi has\na red kite.  ") == ["Ravi", "has", "a", "red", "kite."]
    assert tokens("") == []


def test_key_keeps_letters_of_any_script():
    assert key("Kite,") == "kite"
    assert key("“Up!”") == "up"
    assert key("पेड़।") == "पेड़"
    assert key("—") == ""


def test_chunks_are_sentences():
    words = tokens("Ravi has a kite. Is it red? यह लाल है। The end")
    assert [[words[i] for i in c] for c in chunks(words)] == [
        ["Ravi", "has", "a", "kite."],
        ["Is", "it", "red?"],
        ["यह", "लाल", "है।"],
        ["The", "end"],
    ]


def test_a_long_sentence_is_cut_at_a_late_comma_or_at_the_limit():
    words = [f"w{i}" for i in range(15)] + ["pause,"] + [f"x{i}" for i in range(20)]
    parts = chunks(words)
    assert [len(p) for p in parts] == [16, 20]
    assert all(len(p) <= MAX_CHUNK_WORDS for p in chunks([f"w{i}" for i in range(60)]))
    assert sum(len(p) for p in chunks([f"w{i}" for i in range(60)])) == 60
