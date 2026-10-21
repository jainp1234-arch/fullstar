package com.fullstar.api.studio.ai;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Prompt templates in resources/prompts (Plan 4.3 drafts, 4.4 content check). {@code {{name}}} placeholders are filled in;
 * an unknown placeholder fails loudly so a template never goes out half-filled.
 */
@Component
public class DraftPrompts {

	private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{([a-z_]+)}}");

	private final Map<String, String> templates = new HashMap<>();

	public DraftPrompts() {
		for (String name : new String[] { "draft-system", "draft-lesson", "draft-question_bank", "draft-passage",
				"content-check-system", "content-check-user", "draft-chapter" }) {
			templates.put(name, read(name));
		}
	}

	public record Prompt(String system, String user) {
	}

	/** type is lesson, question_bank or passage. */
	public Prompt draft(String type, Map<String, String> values) {
		return new Prompt(templates.get("draft-system"), fill(templates.get("draft-" + type), values));
	}

	/** A draft based on a family chapter (S9, Plan 5.5): the type prompt, then the chapter text block. */
	public Prompt chapterDraft(String type, Map<String, String> values) {
		return new Prompt(templates.get("draft-system"),
				fill(templates.get("draft-" + type), values) + fill(templates.get("draft-chapter"), values));
	}

	/** The content-check agent (Plan 4.4): checklist and flag format, then the content itself. */
	public Prompt contentCheck(Map<String, String> values) {
		return new Prompt(templates.get("content-check-system"), fill(templates.get("content-check-user"), values));
	}

	static String fill(String template, Map<String, String> values) {
		Matcher matcher = PLACEHOLDER.matcher(template);
		StringBuilder out = new StringBuilder();
		while (matcher.find()) {
			String value = values.get(matcher.group(1));
			if (value == null) {
				throw new IllegalStateException("No value for prompt placeholder " + matcher.group(1));
			}
			matcher.appendReplacement(out, Matcher.quoteReplacement(value));
		}
		matcher.appendTail(out);
		return out.toString();
	}

	private static String read(String name) {
		try (InputStream in = new ClassPathResource("prompts/" + name + ".md").getInputStream()) {
			return new String(in.readAllBytes(), StandardCharsets.UTF_8);
		}
		catch (IOException ex) {
			throw new UncheckedIOException("Missing prompt template " + name, ex);
		}
	}

}
