package com.fullstar.api.common.pagination;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fullstar.api.common.error.ValidationException;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class PaginationTest {

	record Row(String createdAt, UUID id) {
	}

	@Test
	void cursorRoundTripsAndIsOpaque() {
		Cursor cursor = new Cursor("2026-10-20T10:15:30Z", UUID.randomUUID());
		String encoded = cursor.encode();
		assertThat(encoded).doesNotContain("2026").doesNotContain("|");
		assertThat(Cursor.decode(encoded)).isEqualTo(cursor);
	}

	@Test
	void sortKeyMayContainTheSeparator() {
		Cursor cursor = new Cursor("a|b", UUID.randomUUID());
		assertThat(Cursor.decode(cursor.encode())).isEqualTo(cursor);
	}

	@Test
	void invalidCursorIsAValidationError() {
		assertThatThrownBy(() -> Cursor.decode("%%%")).isInstanceOf(ValidationException.class);
		assertThatThrownBy(() -> Cursor.decode("bm8tc2VwYXJhdG9y")).isInstanceOf(ValidationException.class);
		assertThat(Cursor.decode(null)).isNull();
		assertThat(Cursor.decode("")).isNull();
	}

	@Test
	void limitDefaultsTo20AndAllowsUpTo100() {
		assertThat(PageRequest.of(null, null).limit()).isEqualTo(20);
		assertThat(PageRequest.of(100, null).fetchSize()).isEqualTo(101);
		assertThatThrownBy(() -> PageRequest.of(0, null)).isInstanceOf(ValidationException.class);
		assertThatThrownBy(() -> PageRequest.of(101, null)).isInstanceOf(ValidationException.class);
	}

	@Test
	void pageHasNextCursorOnlyWhenMoreRowsExist() {
		List<Row> rows = IntStream.range(0, 4).mapToObj(i -> new Row("t" + i, UUID.randomUUID())).toList();
		PageRequest request = PageRequest.of(3, null);

		CursorPage<Row> page = CursorPage.of(rows, request, r -> new Cursor(r.createdAt(), r.id()));
		assertThat(page.items()).hasSize(3);
		assertThat(Cursor.decode(page.nextCursor())).isEqualTo(new Cursor("t2", rows.get(2).id()));

		CursorPage<Row> last = CursorPage.of(rows.subList(0, 3), request, r -> new Cursor(r.createdAt(), r.id()));
		assertThat(last.items()).hasSize(3);
		assertThat(last.nextCursor()).isNull();
	}

}
