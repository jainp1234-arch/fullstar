package com.fullstar.api.studio.check;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/** Flags of Schema §4.2 content_check_flags, as given by an admin (manual check) or the agent. */
public final class CheckFlags {

	public static final Set<String> SEVERITIES = Set.of("critical", "warning");

	public static final Set<String> CATEGORIES = Set.of("age_suitability", "fact_mismatch", "wrong_answer",
			"language", "difficulty", "bias", "personal_info", "other");

	static final int LOCATION_MAX = 200;

	static final int REASON_MAX = 500;

	private CheckFlags() {
	}

	/** location is a JSON path inside the content, e.g. "body.scenes[2].text" or "title". */
	public record Flag(String severity, String category, String location, String reason) {

		public boolean critical() {
			return "critical".equals(severity);
		}

	}

	/** Reads a JSON array of flags; errors by path under the given prefix (e.g. flags[1].reason). */
	public static List<Flag> read(JsonNode flags, String prefix, Map<String, String> errors) {
		if (flags == null || flags.isNull() || flags.isMissingNode()) {
			return List.of();
		}
		if (!flags.isArray()) {
			errors.put(prefix, "INVALID");
			return List.of();
		}
		List<Flag> out = new ArrayList<>();
		for (int i = 0; i < flags.size(); i++) {
			JsonNode flag = flags.get(i);
			String path = prefix + "[" + i + "]";
			Map<String, String> local = new LinkedHashMap<>();
			String severity = oneOf(flag, "severity", SEVERITIES, path, local);
			String category = oneOf(flag, "category", CATEGORIES, path, local);
			String location = text(flag, "location", LOCATION_MAX, path, local);
			String reason = text(flag, "reason", REASON_MAX, path, local);
			if (local.isEmpty()) {
				out.add(new Flag(severity, category, location, reason));
			}
			errors.putAll(local);
		}
		return out;
	}

	private static String oneOf(JsonNode flag, String name, Set<String> allowed, String path,
			Map<String, String> errors) {
		JsonNode node = flag.path(name);
		if (!node.isString() || node.stringValue().isBlank()) {
			errors.put(path + "." + name, "REQUIRED");
			return null;
		}
		if (!allowed.contains(node.stringValue())) {
			errors.put(path + "." + name, "INVALID");
			return null;
		}
		return node.stringValue();
	}

	private static String text(JsonNode flag, String name, int max, String path, Map<String, String> errors) {
		JsonNode node = flag.path(name);
		// The agent may give {"path": "..."} as in the table comment; both forms are read
		if (node.isObject() && node.path("path").isString()) {
			node = node.path("path");
		}
		if (!node.isString() || node.stringValue().isBlank()) {
			errors.put(path + "." + name, "REQUIRED");
			return null;
		}
		String value = node.stringValue().strip();
		if (value.length() > max) {
			errors.put(path + "." + name, "INVALID_LENGTH");
			return null;
		}
		return value;
	}

}
