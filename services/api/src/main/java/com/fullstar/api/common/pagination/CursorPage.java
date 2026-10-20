package com.fullstar.api.common.pagination;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.function.Function;

/** List response data: { "items": [...], "next_cursor": "..." | null } (Schema §10). */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record CursorPage<T>(List<T> items, String nextCursor) {

	/**
	 * Builds a page from rows fetched with limit + 1: if the extra row exists there is a next page,
	 * and its cursor is the last returned row.
	 */
	public static <T> CursorPage<T> of(List<T> rowsFetched, PageRequest request, Function<T, Cursor> cursorOf) {
		if (rowsFetched.size() <= request.limit()) {
			return new CursorPage<>(List.copyOf(rowsFetched), null);
		}
		List<T> page = List.copyOf(rowsFetched.subList(0, request.limit()));
		return new CursorPage<>(page, cursorOf.apply(page.get(page.size() - 1)).encode());
	}

}
