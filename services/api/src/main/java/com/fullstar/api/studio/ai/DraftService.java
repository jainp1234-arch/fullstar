package com.fullstar.api.studio.ai;

import com.fullstar.api.common.claude.AiProperties;
import com.fullstar.api.common.claude.ClaudeClient;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.studio.content.ContentFormats;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Content drafts (Schema §11 POST /studio/ai/drafts, S4; Plan 4.3). A draft comes from Claude
 * (FEATURE_AI_DRAFTS) or is pasted from a Claude chat (trial "Paste draft"); either way it is read
 * and checked against Schema §5 the same way, and nothing is saved until the admin saves it in S5.
 */
@Service
public class DraftService {

	private static final Logger log = LoggerFactory.getLogger(DraftService.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	/** Schema §4.2 content_versions.title varchar(200). */
	private static final int TITLE_MAX = 200;

	static final int MAX_QUESTIONS = 30;

	private final JdbcTemplate jdbc;

	private final DraftPrompts prompts;

	private final ClaudeClient claude;

	private final AiProperties ai;

	private final ContentFormats formats;

	public DraftService(JdbcTemplate jdbc, DraftPrompts prompts, ClaudeClient claude, AiProperties ai,
			ContentFormats formats) {
		this.jdbc = jdbc;
		this.prompts = prompts;
		this.claude = claude;
		this.ai = ai;
		this.formats = formats;
	}

	/** What to draft. type: lesson, question_bank or passage. */
	public record Request(String type, int classLevel, String subject, UUID topicId, int count, String lang) {
	}

	/** One drafted item, with Schema §5 problems by field path (empty = ready to save). */
	public record Item(String kind, String questionType, String title, int difficulty, JsonNode body,
			JsonNode solution, Map<String, String> errors) {
	}

	public record Draft(String type, String source, List<Item> items) {
	}

	public DraftPrompts.Prompt prompt(Request request) {
		String topic = topicName(request);
		String subject = jdbc.queryForObject("SELECT name FROM app.subjects WHERE code = ?", String.class,
				request.subject());
		Map<String, String> values = Map.of("class_level", String.valueOf(request.classLevel()), "subject", subject,
				"topic", topic, "lang_name", "hi".equals(request.lang()) ? "Hindi" : "English", "count",
				String.valueOf(request.count()), "words", String.valueOf(60 + 30 * request.classLevel()),
				"illustrations", String.join(", ", formats.illustrations()));
		return prompts.draft(request.type(), values);
	}

	/** Asks Claude; FEATURE_AI_DRAFTS must be on (trial: 503 FEATURE_DISABLED, use the pasted path). */
	public Draft fromClaude(Request request) {
		if (!ai.draftsEnabled()) {
			throw new ApiException(ErrorCode.FEATURE_DISABLED,
					"AI drafts are switched off; paste a draft from a Claude chat instead");
		}
		DraftPrompts.Prompt prompt = prompt(request);
		String reply = claude.complete(prompt.system(), prompt.user());
		JsonNode json = readJson(reply);
		if (json == null) {
			log.warn("Claude draft was not JSON type={} chars={}", request.type(), reply.length());
			throw new ApiException(ErrorCode.DEPENDENCY_UNAVAILABLE, "The draft could not be read, please try again");
		}
		Draft draft = items(request.type(), json, "claude");
		log.info("Claude draft type={} items={}", request.type(), draft.items().size());
		return draft;
	}

	/** A draft pasted from a Claude chat (trial). Unreadable JSON → field pasted INVALID_FORMAT. */
	public Draft fromPaste(Request request, String pasted) {
		topicName(request);
		JsonNode json = readJson(pasted);
		if (json == null) {
			throw new ValidationException("The pasted draft is not JSON", Map.of("pasted", "INVALID_FORMAT"));
		}
		return items(request.type(), json, "pasted");
	}

	private Draft items(String type, JsonNode json, String source) {
		List<Item> items = new ArrayList<>();
		if ("question_bank".equals(type)) {
			JsonNode questions = json.isArray() ? json : json.path("questions");
			if (!questions.isArray() || questions.isEmpty()) {
				throw new ValidationException("The draft has no questions", Map.of("questions", "REQUIRED"));
			}
			if (questions.size() > MAX_QUESTIONS) {
				throw new ValidationException("At most " + MAX_QUESTIONS + " questions", Map.of("questions",
						"INVALID_LENGTH"));
			}
			questions.forEach(question -> items.add(item("question", question)));
		}
		else {
			items.add(item(type, json));
		}
		return new Draft(type, source, items);
	}

	private Item item(String kind, JsonNode node) {
		Map<String, String> errors = new LinkedHashMap<>();
		String title = node.path("title").isString() ? node.path("title").stringValue().strip() : "";
		if (title.isEmpty()) {
			errors.put("title", "REQUIRED");
		}
		else if (title.length() > TITLE_MAX) {
			errors.put("title", "INVALID_LENGTH");
		}
		int difficulty = node.path("difficulty").isInt() ? node.path("difficulty").intValue() : 2;
		if (difficulty < 1 || difficulty > 3) {
			errors.put("difficulty", "OUT_OF_RANGE");
			difficulty = 2;
		}
		JsonNode body = node.path("body").isMissingNode() ? JSON.nullNode() : node.get("body");
		JsonNode solution = node.path("solution").isMissingNode() || node.get("solution").isNull() ? null
				: node.get("solution");
		String questionType = null;
		if ("question".equals(kind)) {
			questionType = node.path("question_type").isString() ? node.path("question_type").stringValue() : null;
			if (questionType == null || !ContentFormats.QUESTION_TYPES.contains(questionType)) {
				errors.put("question_type", questionType == null ? "REQUIRED" : "INVALID");
				return new Item(kind, questionType, title, difficulty, body, solution, errors);
			}
		}
		if ("passage".equals(kind) && body.isObject() && body.path("text").isString()) {
			// The word count is ours to work out (prompt: "we recount it")
			((ObjectNode) body).put("word_count", ContentFormats.wordCount(body.path("text").stringValue()));
		}
		ContentFormats.Checked checked = formats.check(ContentFormats.Kind.valueOf(kind.toUpperCase(Locale.ROOT)),
				questionType, body, solution);
		errors.putAll(checked.errors());
		// A draft cannot point at published questions yet; quiz scenes are added in the editor
		checked.quizQuestionPaths().keySet().forEach(path -> errors.put(path, "INVALID"));
		return new Item(kind, questionType, title, difficulty, body, solution, errors);
	}

	private String topicName(Request request) {
		List<String> names = jdbc.queryForList("""
				SELECT t.name FROM app.topics t JOIN app.subjects s ON s.id = t.subject_id
				 WHERE t.id = ? AND t.class_level = ? AND s.code = ? AND t.archived_at IS NULL""", String.class,
				request.topicId(), request.classLevel(), request.subject());
		if (names.isEmpty()) {
			throw new ValidationException("topic_id is not valid", Map.of("topic_id", "INVALID"));
		}
		return names.get(0);
	}

	/** The JSON object in a reply or paste, also inside a ```json fence; null if there is none. */
	static JsonNode readJson(String text) {
		if (text == null) {
			return null;
		}
		int start = text.indexOf('{');
		int arrayStart = text.indexOf('[');
		if (arrayStart >= 0 && (start < 0 || arrayStart < start)) {
			start = arrayStart;
		}
		int end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
		if (start < 0 || end <= start) {
			return null;
		}
		try {
			JsonNode node = JSON.readTree(text.substring(start, end + 1));
			return node.isObject() || node.isArray() ? node : null;
		}
		catch (JacksonException ex) {
			return null;
		}
	}

}
