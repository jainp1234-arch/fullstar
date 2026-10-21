package com.fullstar.api.common.jsonschema;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class JsonSchemaValidatorTest {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static JsonNode json(String text) {
		return JSON.readTree(text.replace('\'', '"'));
	}

	private static final JsonSchemaValidator SCHEMA = JsonSchemaValidator.of(json("""
			{ 'type': 'object', 'required': ['name', 'items'], 'additionalProperties': false,
			  'properties': {
			    'name': { 'type': 'string', 'minLength': 1, 'maxLength': 5 },
			    'code': { 'type': 'string', 'pattern': '^[a-z]+$' },
			    'level': { 'type': 'integer', 'minimum': 1, 'maximum': 3 },
			    'kind': { 'enum': ['a', 'b'] },
			    'fixed': { 'const': true },
			    'note': { 'type': ['string', 'null'] },
			    'items': { 'type': 'array', 'minItems': 1, 'maxItems': 2,
			               'items': { 'type': 'object', 'required': ['id'], 'properties': { 'id': { 'type': 'string' } } } }
			  } }"""));

	@Test
	void validValueHasNoErrors() {
		assertThat(SCHEMA.validate(json("""
				{ 'name': 'Asha', 'code': 'abc', 'level': 2, 'kind': 'a', 'fixed': true, 'note': null,
				  'items': [{ 'id': 'x' }] }"""), "body")).isEmpty();
		assertThat(SCHEMA.validate(json("{ 'name': 'Asha', 'level': 2.0, 'items': [{ 'id': 'x' }] }"), "body"))
			.isEmpty();
	}

	@Test
	void reportsEachProblemWithItsPathAndCode() {
		assertThat(SCHEMA.validate(json("""
				{ 'name': '  ', 'code': 'ABC', 'level': 9, 'kind': 'z', 'fixed': false, 'extra': 1,
				  'items': [{ 'id': 'x' }, {}, { 'id': 3 }] }"""), "body"))
			.containsEntry("body.name", "REQUIRED")
			.containsEntry("body.code", "INVALID_FORMAT")
			.containsEntry("body.level", "OUT_OF_RANGE")
			.containsEntry("body.kind", "INVALID")
			.containsEntry("body.fixed", "INVALID")
			.containsEntry("body.extra", "INVALID")
			.containsEntry("body.items", "INVALID_LENGTH")
			.containsEntry("body.items[1].id", "REQUIRED")
			.containsEntry("body.items[2].id", "INVALID");
	}

	@Test
	void missingTooLongWrongTypeAndNull() {
		assertThat(SCHEMA.validate(json("{ 'name': 'Asha Rao', 'level': 1.5, 'note': 4 }"), "body"))
			.containsEntry("body.name", "INVALID_LENGTH")
			.containsEntry("body.items", "REQUIRED")
			.containsEntry("body.level", "INVALID")
			.containsEntry("body.note", "INVALID");
		assertThat(SCHEMA.validate(json("{ 'name': 'A', 'items': [] }"), "body")).containsEntry("body.items", "REQUIRED");
		assertThat(SCHEMA.validate(JSON.nullNode(), "body")).containsEntry("body", "REQUIRED");
		assertThat(SCHEMA.validate(json("[]"), "body")).containsEntry("body", "INVALID");
	}

	@Test
	void unsupportedKeywordsAreRefusedWhenLoading() {
		assertThatThrownBy(() -> JsonSchemaValidator.of(json("{ 'type': 'object', 'oneOf': [] }")))
			.isInstanceOf(IllegalArgumentException.class)
			.hasMessageContaining("oneOf");
		assertThatThrownBy(() -> JsonSchemaValidator
			.of(json("{ 'properties': { 'a': { 'items': { 'format': 'uuid' } } } }")))
			.hasMessageContaining("#/properties/a/items");
	}

}
