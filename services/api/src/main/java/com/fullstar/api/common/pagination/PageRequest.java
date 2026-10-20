package com.fullstar.api.common.pagination;

import com.fullstar.api.common.error.ValidationException;
import java.util.Map;

/** ?limit=20&cursor=... with limit 1–100, default 20 (Schema §10). Fetch limit + 1 rows. */
public record PageRequest(int limit, Cursor cursor) {

	public static final int DEFAULT_LIMIT = 20;

	public static final int MAX_LIMIT = 100;

	public static PageRequest of(Integer limit, String cursor) {
		int value = limit == null ? DEFAULT_LIMIT : limit;
		if (value < 1 || value > MAX_LIMIT) {
			throw new ValidationException("limit must be between 1 and " + MAX_LIMIT, Map.of("limit", "OUT_OF_RANGE"));
		}
		return new PageRequest(value, Cursor.decode(cursor));
	}

	public int fetchSize() {
		return limit + 1;
	}

}
