package com.fullstar.api.common.pagination;

import com.fullstar.api.common.error.ValidationException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

/**
 * Opaque list cursor (Schema §10): base64 of the last row's sort key and id. The sort key is any
 * string the query orders by (e.g. an ISO timestamp); ties are broken by id.
 */
public record Cursor(String sortKey, UUID id) {

	private static final char SEPARATOR = '|';

	public String encode() {
		String raw = sortKey + SEPARATOR + id;
		return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
	}

	/** Decodes a cursor from the query string; null or blank means the first page. */
	public static Cursor decode(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			String raw = new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
			int split = raw.lastIndexOf(SEPARATOR);
			if (split <= 0) {
				throw new IllegalArgumentException("no separator");
			}
			return new Cursor(raw.substring(0, split), UUID.fromString(raw.substring(split + 1)));
		}
		catch (IllegalArgumentException ex) {
			throw new ValidationException("cursor is not valid", Map.of("cursor", "INVALID"));
		}
	}

}
