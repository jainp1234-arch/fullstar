package com.fullstar.api.common.error;

import java.sql.SQLException;
import java.util.Arrays;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Maps PostgreSQL errors to API errors. The §6 functions raise P0001 with the error code as the
 * message (e.g. MAX_CHILDREN) and P0002 for NOT_FOUND.
 */
@Component
public class DatabaseErrorTranslator {

	private static final String RAISE_EXCEPTION = "P0001";

	private static final String NO_DATA_FOUND = "P0002";

	private static final String UNIQUE_VIOLATION = "23505";

	private static final String FOREIGN_KEY_VIOLATION = "23503";

	private static final String CHECK_VIOLATION = "23514";

	private static final String NOT_NULL_VIOLATION = "23502";

	private static final String RLS_VIOLATION = "42501";

	private static final Set<String> RAISED_CODES = Arrays.stream(ErrorCode.values())
		.map(Enum::name)
		.collect(Collectors.toUnmodifiableSet());

	/** Returns the API error for the first SQLException in the cause chain, if it is a known kind. */
	public Optional<ApiException> translate(Throwable failure) {
		return findSqlException(failure).flatMap(DatabaseErrorTranslator::toApiException);
	}

	private static Optional<ApiException> toApiException(SQLException ex) {
		String state = ex.getSQLState();
		if (state == null) {
			return Optional.empty();
		}
		return switch (state) {
			case RAISE_EXCEPTION -> raisedCode(ex.getMessage())
				.map(code -> new ApiException(code, messageFor(code)));
			case NO_DATA_FOUND -> Optional.of(new NotFoundException());
			case UNIQUE_VIOLATION -> Optional.of(new ApiException(ErrorCode.CONFLICT, "Already exists"));
			case FOREIGN_KEY_VIOLATION, CHECK_VIOLATION, NOT_NULL_VIOLATION ->
				Optional.of(new ApiException(ErrorCode.VALIDATION_FAILED, "Request is not valid"));
			case RLS_VIOLATION -> Optional.of(new ApiException(ErrorCode.FORBIDDEN, "Not allowed"));
			default -> Optional.empty();
		};
	}

	/** PostgreSQL message: "ERROR: MAX_CHILDREN" (possibly followed by "Where:" context lines). */
	private static Optional<ErrorCode> raisedCode(String message) {
		if (message == null) {
			return Optional.empty();
		}
		return Arrays.stream(message.split("[^A-Z_]+"))
			.filter(RAISED_CODES::contains)
			.findFirst()
			.map(ErrorCode::valueOf);
	}

	private static String messageFor(ErrorCode code) {
		return switch (code) {
			case MAX_CHILDREN -> "A family can have at most two children";
			case BOOK_MISMATCH -> "This book does not match the child's class or subject";
			case READING_LIMIT -> "Reading test limit reached for today";
			case VERSION_IMMUTABLE -> "A saved version cannot be changed";
			case CHECK_NOT_PASSED -> "Only a version that passed the content check can be published";
			case MAX_CLASS -> "The child is already in the highest class";
			default -> "Request blocked";
		};
	}

	private static Optional<SQLException> findSqlException(Throwable failure) {
		for (Throwable t = failure; t != null; t = t.getCause()) {
			if (t instanceof SQLException sql) {
				return Optional.of(sql);
			}
			if (t.getCause() == t) {
				break;
			}
		}
		return Optional.empty();
	}

}
