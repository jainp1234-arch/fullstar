package com.fullstar.api.common.jsonschema;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * A small JSON Schema (draft 2020-12) validator for the content formats of Schema §5, so no extra
 * library is needed (Plan 4.2). Supported keywords: type, required, properties,
 * additionalProperties (boolean or schema), items, enum, const, minimum, maximum, minLength,
 * maxLength, minItems, maxItems, pattern. Annotation keywords ($schema, $id, title, description)
 * are ignored; any other keyword is refused when the schema is loaded, so a schema never silently
 * means less than it says.
 * <p>
 * Errors are returned as path → field code, e.g. {@code body.scenes[2].text → REQUIRED}, using the
 * codes of Schema §10 (REQUIRED, INVALID, INVALID_LENGTH, OUT_OF_RANGE, INVALID_FORMAT). Only the
 * first error per path is kept.
 */
public final class JsonSchemaValidator {

	public static final String REQUIRED = "REQUIRED";

	public static final String INVALID = "INVALID";

	public static final String INVALID_LENGTH = "INVALID_LENGTH";

	public static final String OUT_OF_RANGE = "OUT_OF_RANGE";

	public static final String INVALID_FORMAT = "INVALID_FORMAT";

	private static final Set<String> KEYWORDS = Set.of("$schema", "$id", "title", "description", "type", "required",
			"properties", "additionalProperties", "items", "enum", "const", "minimum", "maximum", "minLength",
			"maxLength", "minItems", "maxItems", "pattern");

	private final JsonNode schema;

	private final Map<String, Pattern> patterns = new LinkedHashMap<>();

	private JsonSchemaValidator(JsonNode schema) {
		this.schema = schema;
	}

	/** Checks the schema itself; throws IllegalArgumentException for unsupported keywords. */
	public static JsonSchemaValidator of(JsonNode schema) {
		JsonSchemaValidator validator = new JsonSchemaValidator(schema);
		validator.check(schema, "#");
		return validator;
	}

	/** Validates the value; returns path → code, empty when valid. */
	public Map<String, String> validate(JsonNode value, String rootPath) {
		Map<String, String> errors = new LinkedHashMap<>();
		validate(schema, value, rootPath, errors);
		return errors;
	}

	private void validate(JsonNode schema, JsonNode value, String path, Map<String, String> errors) {
		if (schema.isBoolean()) {
			if (!schema.booleanValue()) {
				errors.putIfAbsent(path, INVALID);
			}
			return;
		}
		JsonNode type = schema.get("type");
		if (type != null && !matchesType(type, value)) {
			errors.putIfAbsent(path, value.isNull() ? REQUIRED : INVALID);
			return;
		}
		JsonNode constant = schema.get("const");
		if (constant != null && !constant.equals(value)) {
			errors.putIfAbsent(path, INVALID);
			return;
		}
		JsonNode allowed = schema.get("enum");
		if (allowed != null && !contains(allowed, value)) {
			errors.putIfAbsent(path, INVALID);
			return;
		}
		if (value.isNumber()) {
			numeric(schema, value, path, errors);
		}
		else if (value.isString()) {
			text(schema, value.stringValue(), path, errors);
		}
		else if (value.isArray()) {
			array(schema, value, path, errors);
		}
		else if (value.isObject()) {
			object(schema, value, path, errors);
		}
	}

	private void numeric(JsonNode schema, JsonNode value, String path, Map<String, String> errors) {
		JsonNode minimum = schema.get("minimum");
		JsonNode maximum = schema.get("maximum");
		if ((minimum != null && value.decimalValue().compareTo(minimum.decimalValue()) < 0)
				|| (maximum != null && value.decimalValue().compareTo(maximum.decimalValue()) > 0)) {
			errors.putIfAbsent(path, OUT_OF_RANGE);
		}
	}

	private void text(JsonNode schema, String value, String path, Map<String, String> errors) {
		int length = value.codePointCount(0, value.length());
		JsonNode minLength = schema.get("minLength");
		JsonNode maxLength = schema.get("maxLength");
		// With minLength ≥ 1 an empty or blank text reads as "missing"
		if (minLength != null && minLength.intValue() > 0 && value.isBlank()) {
			errors.putIfAbsent(path, REQUIRED);
			return;
		}
		if (minLength != null && length < minLength.intValue()) {
			errors.putIfAbsent(path, INVALID_LENGTH);
			return;
		}
		if (maxLength != null && length > maxLength.intValue()) {
			errors.putIfAbsent(path, INVALID_LENGTH);
			return;
		}
		JsonNode pattern = schema.get("pattern");
		if (pattern != null && !patterns.get(pattern.stringValue()).matcher(value).find()) {
			errors.putIfAbsent(path, INVALID_FORMAT);
		}
	}

	private void array(JsonNode schema, JsonNode value, String path, Map<String, String> errors) {
		JsonNode minItems = schema.get("minItems");
		JsonNode maxItems = schema.get("maxItems");
		if ((minItems != null && value.size() < minItems.intValue())
				|| (maxItems != null && value.size() > maxItems.intValue())) {
			errors.putIfAbsent(path, value.isEmpty() ? REQUIRED : INVALID_LENGTH);
		}
		JsonNode items = schema.get("items");
		if (items != null) {
			for (int i = 0; i < value.size(); i++) {
				validate(items, value.get(i), path + "[" + i + "]", errors);
			}
		}
	}

	private void object(JsonNode schema, JsonNode value, String path, Map<String, String> errors) {
		JsonNode required = schema.get("required");
		if (required != null) {
			for (JsonNode name : required) {
				if (!value.has(name.stringValue())) {
					errors.putIfAbsent(child(path, name.stringValue()), REQUIRED);
				}
			}
		}
		JsonNode properties = schema.get("properties");
		JsonNode additional = schema.get("additionalProperties");
		for (Iterator<String> names = value.propertyNames().iterator(); names.hasNext();) {
			String name = names.next();
			JsonNode propertySchema = properties == null ? null : properties.get(name);
			if (propertySchema != null) {
				validate(propertySchema, value.get(name), child(path, name), errors);
			}
			else if (additional != null) {
				validate(additional, value.get(name), child(path, name), errors);
			}
		}
	}

	private static String child(String path, String name) {
		return path.isEmpty() ? name : path + "." + name;
	}

	private static boolean matchesType(JsonNode type, JsonNode value) {
		if (type.isArray()) {
			for (JsonNode one : type) {
				if (matchesType(one, value)) {
					return true;
				}
			}
			return false;
		}
		return switch (type.stringValue()) {
			case "object" -> value.isObject();
			case "array" -> value.isArray();
			case "string" -> value.isString();
			case "boolean" -> value.isBoolean();
			case "null" -> value.isNull();
			case "number" -> value.isNumber();
			case "integer" -> value.isIntegralNumber()
					|| (value.isNumber() && value.decimalValue().stripTrailingZeros().scale() <= 0);
			default -> false;
		};
	}

	private static boolean contains(JsonNode allowed, JsonNode value) {
		for (JsonNode candidate : allowed) {
			if (candidate.equals(value)) {
				return true;
			}
		}
		return false;
	}

	private void check(JsonNode schema, String where) {
		if (schema.isBoolean()) {
			return;
		}
		if (!schema.isObject()) {
			throw new IllegalArgumentException("Schema at " + where + " is not an object");
		}
		for (String keyword : schema.propertyNames()) {
			if (!KEYWORDS.contains(keyword)) {
				throw new IllegalArgumentException("Unsupported JSON Schema keyword " + keyword + " at " + where);
			}
		}
		JsonNode pattern = schema.get("pattern");
		if (pattern != null) {
			patterns.computeIfAbsent(pattern.stringValue(), Pattern::compile);
		}
		JsonNode properties = schema.get("properties");
		if (properties != null) {
			for (String name : properties.propertyNames()) {
				check(properties.get(name), where + "/properties/" + name);
			}
		}
		JsonNode additional = schema.get("additionalProperties");
		if (additional != null) {
			check(additional, where + "/additionalProperties");
		}
		JsonNode items = schema.get("items");
		if (items != null) {
			check(items, where + "/items");
		}
	}

}
