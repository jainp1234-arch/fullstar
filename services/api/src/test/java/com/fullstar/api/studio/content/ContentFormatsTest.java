package com.fullstar.api.studio.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.api.studio.content.ContentFormats.Kind;
import com.fullstar.api.testsupport.ContentSamples;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Schema §5 formats: the JSON Schema files plus the rules between fields. */
class ContentFormatsTest {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final ContentFormats formats = new ContentFormats();

	private static JsonNode json(String text) {
		return text == null ? null : JSON.readTree(text);
	}

	private Map<String, String> errors(Kind kind, String type, String body, String solution) {
		return formats.check(kind, type, json(body), json(solution)).errors();
	}

	@Test
	void everySampleIsValid() {
		assertThat(errors(Kind.LESSON, null, ContentSamples.LESSON, null)).isEmpty();
		assertThat(errors(Kind.PASSAGE, null, ContentSamples.PASSAGE, null)).isEmpty();
		assertThat(errors(Kind.QUESTION, "mcq", ContentSamples.MCQ, ContentSamples.MCQ_SOLUTION)).isEmpty();
		assertThat(errors(Kind.QUESTION, "true_false", ContentSamples.TRUE_FALSE, ContentSamples.TRUE_FALSE_SOLUTION))
			.isEmpty();
		assertThat(errors(Kind.QUESTION, "fill_blank", ContentSamples.FILL_BLANK, ContentSamples.FILL_BLANK_SOLUTION))
			.isEmpty();
		assertThat(errors(Kind.QUESTION, "match", ContentSamples.MATCH, ContentSamples.MATCH_SOLUTION)).isEmpty();
	}

	@Test
	void lessonScenesAreNarrationOrQuizWithKnownVisuals() {
		assertThat(errors(Kind.LESSON, null, """
				{ "scenes": [
				    { "id": "s1", "duration_ms": 1000 },
				    { "id": "s1", "duration_ms": 1000, "text": "Hi",
				      "quiz": { "question_item_id": "00000000-0000-0000-0000-000000000001" } } ] }""", null))
			.containsEntry("body.scenes[0].text", "REQUIRED")
			.containsEntry("body.scenes[1].id", "INVALID")
			.containsEntry("body.scenes[1].quiz", "INVALID");
		assertThat(errors(Kind.LESSON, null, """
				{ "scenes": [ { "id": "S 1", "duration_ms": 70000, "text": "",
				    "visual": { "illustration": "dragon", "animation": "spin" } } ] }""", null))
			.containsEntry("body.scenes[0].id", "INVALID_FORMAT")
			.containsEntry("body.scenes[0].duration_ms", "OUT_OF_RANGE")
			.containsEntry("body.scenes[0].text", "REQUIRED")
			.containsEntry("body.scenes[0].visual.illustration", "INVALID")
			.containsEntry("body.scenes[0].visual.animation", "INVALID");
		assertThat(errors(Kind.LESSON, null, ContentSamples.LESSON, ContentSamples.MCQ_SOLUTION))
			.containsEntry("solution", "INVALID");
	}

	@Test
	void quizScenesAreReportedForTheDatabaseCheck() {
		ContentFormats.Checked checked = formats.check(Kind.LESSON, null, json("""
				{ "scenes": [ { "id": "q", "duration_ms": 0,
				    "quiz": { "question_item_id": "00000000-0000-0000-0000-000000000001" } } ] }"""), null);
		assertThat(checked.errors()).isEmpty();
		assertThat(checked.quizQuestionPaths()).containsEntry("body.scenes[0].quiz.question_item_id",
				"00000000-0000-0000-0000-000000000001");
	}

	@Test
	void answersMustBeAmongTheChoices() {
		assertThat(errors(Kind.QUESTION, "mcq", ContentSamples.MCQ, """
				{ "correct": ["d"], "explanation": "x" }""")).containsEntry("solution.correct[0]", "INVALID");
		assertThat(errors(Kind.QUESTION, "mcq", """
				{ "prompt": "p", "options": [{"id":"a","text":"x"},{"id":"a","text":"y"},{"id":"b","text":"z"},
				  {"id":"c","text":"w"},{"id":"d","text":"v"}] }""", ContentSamples.MCQ_SOLUTION))
			.containsEntry("body.options", "INVALID_LENGTH");
		assertThat(errors(Kind.QUESTION, "fill_blank", ContentSamples.FILL_BLANK, """
				{ "correct": "sitting", "explanation": "x" }""")).containsEntry("solution.correct", "INVALID");
		assertThat(errors(Kind.QUESTION, "fill_blank", """
				{ "prompt": "No blank here.", "choices": ["a", "b"] }""", ContentSamples.FILL_BLANK_SOLUTION))
			.containsEntry("body.prompt", "INVALID_FORMAT");
		assertThat(errors(Kind.QUESTION, "true_false", ContentSamples.TRUE_FALSE, """
				{ "correct": "yes", "explanation": "x" }""")).containsEntry("solution.correct", "INVALID");
		assertThat(errors(Kind.QUESTION, "mcq", ContentSamples.MCQ, null)).containsEntry("solution", "REQUIRED");
	}

	@Test
	void everyLeftItemHasExactlyOnePartner() {
		assertThat(errors(Kind.QUESTION, "match", ContentSamples.MATCH, """
				{ "pairs": [["l1","r2"],["l1","r1"]], "explanation": "x" }"""))
			.containsEntry("solution.pairs[1]", "INVALID");
		assertThat(errors(Kind.QUESTION, "match", """
				{ "prompt": "p", "left": [{"id":"l1","text":"a"},{"id":"l2","text":"b"},{"id":"l3","text":"c"}],
				  "right": [{"id":"r1","text":"x"},{"id":"r2","text":"y"},{"id":"r3","text":"z"}] }""",
				ContentSamples.MATCH_SOLUTION))
			.containsEntry("solution.pairs", "INVALID_LENGTH");
	}

	@Test
	void passageWordCountMatchesTheText() {
		assertThat(errors(Kind.PASSAGE, null, """
				{ "text": "Ravi has a red kite.", "word_count": 9, "level": 1 }""", null))
			.containsEntry("body.word_count", "INVALID");
		assertThat(ContentFormats.wordCount("  राम  स्कूल जाता है।\nवह खुश है। ")).isEqualTo(7);
		assertThat(ContentFormats.durationSeconds(json(ContentSamples.LESSON))).isEqualTo(15);
	}

}
