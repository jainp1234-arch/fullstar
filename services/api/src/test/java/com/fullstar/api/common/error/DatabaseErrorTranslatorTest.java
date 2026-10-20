package com.fullstar.api.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.dao.DataIntegrityViolationException;
import org.junit.jupiter.api.Test;

class DatabaseErrorTranslatorTest {

	private final DatabaseErrorTranslator translator = new DatabaseErrorTranslator();

	@ParameterizedTest
	@CsvSource({ "MAX_CHILDREN,409", "BOOK_MISMATCH,409", "CHECK_NOT_PASSED,409", "MAX_CLASS,409",
			"VERSION_IMMUTABLE,409", "READING_LIMIT,429" })
	void raisedCodesMapToTheirHttpStatus(String code, int httpStatus) {
		SQLException sql = new SQLException("ERROR: " + code + "\n  Where: PL/pgSQL function app.x() line 4 at RAISE",
				"P0001");
		ApiException ex = translator.translate(new DataIntegrityViolationException("wrapped", sql)).orElseThrow();
		assertThat(ex.code().name()).isEqualTo(code);
		assertThat(ex.code().status().value()).isEqualTo(httpStatus);
	}

	@ParameterizedTest
	@CsvSource({ "P0002,NOT_FOUND", "23505,CONFLICT", "23503,VALIDATION_FAILED", "23514,VALIDATION_FAILED",
			"23502,VALIDATION_FAILED", "42501,FORBIDDEN" })
	void sqlStatesMapToErrorCodes(String state, String code) {
		ApiException ex = translator.translate(new SQLException("detail with private data", state)).orElseThrow();
		assertThat(ex.code().name()).isEqualTo(code);
		assertThat(ex.getMessage()).doesNotContain("private data");
	}

	@Test
	void unknownErrorsAreNotTranslated() {
		assertThat(translator.translate(new SQLException("boom", "XX000"))).isEmpty();
		assertThat(translator.translate(new SQLException("ERROR: SOMETHING_ELSE", "P0001"))).isEmpty();
		assertThat(translator.translate(new IllegalStateException("no sql"))).isEmpty();
	}

}
