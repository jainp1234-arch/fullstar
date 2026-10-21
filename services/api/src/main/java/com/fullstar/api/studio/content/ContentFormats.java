package com.fullstar.api.studio.content;

import com.fullstar.api.common.jsonschema.JsonSchemaValidator;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The content formats of Schema §5: the JSON Schema files in resources/schemas, then the rules a
 * schema cannot express (unique ids, the answer is one of the options, a scene is narration or a
 * quiz, the word count matches). Errors are field path → code, paths starting "body." or
 * "solution.".
 */
@Component
public class ContentFormats {

	public enum Kind {

		LESSON, QUESTION, PASSAGE

	}

	public static final List<String> QUESTION_TYPES = List.of("mcq", "true_false", "fill_blank", "match");

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final Map<String, JsonSchemaValidator> schemas = new HashMap<>();

	private final List<String> illustrations = new ArrayList<>();

	public ContentFormats() {
		load("lesson.body");
		load("passage.body");
		for (String type : QUESTION_TYPES) {
			load("question-" + type + ".body");
			load("question-" + type + ".solution");
		}
	}

	/** Lesson scenes that point at questions; the caller checks they are published questions. */
	public record Checked(Map<String, String> errors, Map<String, String> quizQuestionPaths) {
	}

	public Checked check(Kind kind, String questionType, JsonNode body, JsonNode solution) {
		Map<String, String> errors = new LinkedHashMap<>();
		Map<String, String> quizzes = new LinkedHashMap<>();
		JsonNode bodyValue = body == null ? JSON.nullNode() : body;
		boolean hasSolution = solution != null && !solution.isNull() && !solution.isMissingNode();
		switch (kind) {
			case LESSON -> {
				errors.putAll(schemas.get("lesson.body").validate(bodyValue, "body"));
				if (errors.isEmpty()) {
					lesson(bodyValue, errors, quizzes);
				}
				if (hasSolution) {
					errors.put("solution", JsonSchemaValidator.INVALID);
				}
			}
			case PASSAGE -> {
				errors.putAll(schemas.get("passage.body").validate(bodyValue, "body"));
				if (errors.isEmpty()) {
					passage(bodyValue, errors);
				}
				if (hasSolution) {
					errors.put("solution", JsonSchemaValidator.INVALID);
				}
			}
			case QUESTION -> {
				errors.putAll(schemas.get("question-" + questionType + ".body").validate(bodyValue, "body"));
				errors.putAll(schemas.get("question-" + questionType + ".solution")
					.validate(solution == null ? JSON.nullNode() : solution, "solution"));
				if (errors.isEmpty()) {
					question(questionType, bodyValue, solution, errors);
				}
			}
		}
		return new Checked(errors, quizzes);
	}

	/** The picture keys a lesson scene may use (lesson.body.schema.json). */
	public List<String> illustrations() {
		return List.copyOf(illustrations);
	}

	/** Words in a passage: runs of non-space characters (works for Hindi too). */
	public static int wordCount(String text) {
		String trimmed = text.strip();
		return trimmed.isEmpty() ? 0 : trimmed.split("\\s+").length;
	}

	/** Lesson length: the sum of the scenes' durations, rounded up to whole seconds. */
	public static int durationSeconds(JsonNode body) {
		long ms = 0;
		for (JsonNode scene : body.path("scenes")) {
			ms += scene.path("duration_ms").asLong();
		}
		return (int) ((ms + 999) / 1000);
	}

	private static void lesson(JsonNode body, Map<String, String> errors, Map<String, String> quizzes) {
		Set<String> ids = new HashSet<>();
		JsonNode scenes = body.get("scenes");
		for (int i = 0; i < scenes.size(); i++) {
			JsonNode scene = scenes.get(i);
			String path = "body.scenes[" + i + "]";
			if (!ids.add(scene.get("id").stringValue())) {
				errors.put(path + ".id", JsonSchemaValidator.INVALID);
			}
			boolean text = scene.hasNonNull("text");
			boolean quiz = scene.hasNonNull("quiz");
			if (text == quiz) {
				// Narration or quiz, never both or neither
				errors.put(path + (text ? ".quiz" : ".text"),
						text ? JsonSchemaValidator.INVALID : JsonSchemaValidator.REQUIRED);
			}
			else if (quiz) {
				quizzes.put(path + ".quiz.question_item_id", scene.get("quiz").get("question_item_id").stringValue());
			}
		}
	}

	private static void passage(JsonNode body, Map<String, String> errors) {
		if (wordCount(body.get("text").stringValue()) != body.get("word_count").intValue()) {
			errors.put("body.word_count", JsonSchemaValidator.INVALID);
		}
	}

	private static void question(String type, JsonNode body, JsonNode solution, Map<String, String> errors) {
		switch (type) {
			case "mcq" -> {
				Set<String> options = uniqueIds(body.get("options"), "body.options", errors);
				if (!options.contains(solution.get("correct").get(0).stringValue())) {
					errors.put("solution.correct[0]", JsonSchemaValidator.INVALID);
				}
			}
			case "fill_blank" -> {
				Set<String> choices = new HashSet<>();
				JsonNode list = body.get("choices");
				for (int i = 0; i < list.size(); i++) {
					if (!choices.add(list.get(i).stringValue().strip())) {
						errors.put("body.choices[" + i + "]", JsonSchemaValidator.INVALID);
					}
				}
				if (!choices.contains(solution.get("correct").stringValue().strip())) {
					errors.put("solution.correct", JsonSchemaValidator.INVALID);
				}
			}
			case "match" -> match(body, solution, errors);
			default -> {
				// true_false: the schemas say it all
			}
		}
	}

	private static void match(JsonNode body, JsonNode solution, Map<String, String> errors) {
		Set<String> left = uniqueIds(body.get("left"), "body.left", errors);
		Set<String> right = uniqueIds(body.get("right"), "body.right", errors);
		JsonNode pairs = solution.get("pairs");
		Set<String> leftUsed = new HashSet<>();
		Set<String> rightUsed = new HashSet<>();
		for (int i = 0; i < pairs.size(); i++) {
			String l = pairs.get(i).get(0).stringValue();
			String r = pairs.get(i).get(1).stringValue();
			if (!left.contains(l) || !leftUsed.add(l) || !right.contains(r) || !rightUsed.add(r)) {
				errors.put("solution.pairs[" + i + "]", JsonSchemaValidator.INVALID);
			}
		}
		if (pairs.size() != left.size() && !errors.containsKey("solution.pairs")) {
			// Every left item needs exactly one partner
			errors.put("solution.pairs", JsonSchemaValidator.INVALID_LENGTH);
		}
	}

	private static Set<String> uniqueIds(JsonNode list, String path, Map<String, String> errors) {
		Set<String> ids = new HashSet<>();
		for (int i = 0; i < list.size(); i++) {
			if (!ids.add(list.get(i).get("id").stringValue())) {
				errors.put(path + "[" + i + "].id", JsonSchemaValidator.INVALID);
			}
		}
		return ids;
	}

	private void load(String name) {
		try (InputStream in = new ClassPathResource("schemas/" + name + ".schema.json").getInputStream()) {
			JsonNode schema = JSON.readTree(in);
			schemas.put(name, JsonSchemaValidator.of(schema));
			if ("lesson.body".equals(name)) {
				schema.at("/properties/scenes/items/properties/visual/properties/illustration/enum")
					.forEach(key -> illustrations.add(key.stringValue()));
			}
		}
		catch (IOException ex) {
			throw new UncheckedIOException("Missing content schema " + name, ex);
		}
	}

}
