package com.fullstar.api.studio.content;

import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Ids and subject codes in Studio requests. */
final class StudioIds {

	private StudioIds() {
	}

	/** A malformed path id is the same as an unknown one. */
	static UUID path(String id) {
		try {
			return UUID.fromString(id);
		}
		catch (IllegalArgumentException | NullPointerException ex) {
			throw new NotFoundException();
		}
	}

	/** A body or query id; null stays null, malformed → field INVALID. */
	static UUID field(String value, String field) {
		if (value == null) {
			return null;
		}
		try {
			return UUID.fromString(value);
		}
		catch (IllegalArgumentException ex) {
			throw new ValidationException(field + " is not valid", Map.of(field, "INVALID"));
		}
	}

	/** The id of an active subject taught in that class (class_subjects); otherwise field INVALID. */
	static short subject(JdbcTemplate jdbc, int classLevel, String code, String field) {
		java.util.List<Short> ids = jdbc.queryForList("""
				SELECT s.id FROM app.subjects s
				  JOIN app.class_subjects cs ON cs.subject_id = s.id AND cs.class_level = ?
				 WHERE s.code = ? AND s.active""", Short.class, classLevel, code);
		if (ids.isEmpty()) {
			throw new ValidationException(field + " is not valid", Map.of(field, "INVALID"));
		}
		return ids.get(0);
	}

}
