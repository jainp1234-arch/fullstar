package com.fullstar.api.testsupport;

/** Valid Schema §5 bodies and solutions, as JSON text. */
public final class ContentSamples {

	private ContentSamples() {
	}

	public static final String LESSON = """
			{ "scenes": [
			    { "id": "s1", "duration_ms": 8000, "text": "A bird builds a nest.",
			      "visual": { "illustration": "subject-evs", "animation": "fade-up" }, "quiz": null },
			    { "id": "s2", "duration_ms": 6500, "text": "It uses twigs and grass." } ] }""";

	public static final String MCQ = """
			{ "prompt": "Which word is a noun?", "image_key": null,
			  "options": [{"id":"a","text":"run"},{"id":"b","text":"bird"},{"id":"c","text":"blue"}] }""";

	public static final String MCQ_SOLUTION = """
			{ "correct": ["b"], "explanation": "A bird is a thing, so it is a noun." }""";

	public static final String TRUE_FALSE = """
			{ "prompt": "Fish live in water." }""";

	public static final String TRUE_FALSE_SOLUTION = """
			{ "correct": true, "explanation": "Fish breathe with gills in water." }""";

	public static final String FILL_BLANK = """
			{ "prompt": "The cat ___ on the mat.", "choices": ["sat", "sit", "sits"] }""";

	public static final String FILL_BLANK_SOLUTION = """
			{ "correct": "sat", "explanation": "It happened before, so we use sat." }""";

	public static final String MATCH = """
			{ "prompt": "Match the animal to its home.",
			  "left": [{"id":"l1","text":"Bird"},{"id":"l2","text":"Bee"}],
			  "right": [{"id":"r1","text":"Hive"},{"id":"r2","text":"Nest"}] }""";

	public static final String MATCH_SOLUTION = """
			{ "pairs": [["l1","r2"],["l2","r1"]], "explanation": "Birds live in nests, bees in hives." }""";

	public static final String PASSAGE = """
			{ "text": "Ravi has a red kite. He flies it in the park.", "word_count": 11, "level": 1 }""";

}
