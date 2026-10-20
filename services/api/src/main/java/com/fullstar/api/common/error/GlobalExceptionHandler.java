package com.fullstar.api.common.error;

import com.fullstar.api.common.web.ApiError;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** The one place errors become §10 envelopes. No stack traces or internal details in responses. */
@RestControllerAdvice
public class GlobalExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

	private final DatabaseErrorTranslator databaseErrors;

	public GlobalExceptionHandler(DatabaseErrorTranslator databaseErrors) {
		this.databaseErrors = databaseErrors;
	}

	@ExceptionHandler(ApiException.class)
	ResponseEntity<ApiResponse<Void>> handleApi(ApiException ex) {
		if (ex.code().status().is5xxServerError()) {
			log.warn("Request failed with {}", ex.code(), ex);
		}
		return respond(ex);
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	ResponseEntity<ApiResponse<Void>> handleInvalidBody(MethodArgumentNotValidException ex) {
		Map<String, String> fields = new LinkedHashMap<>();
		for (FieldError error : ex.getBindingResult().getFieldErrors()) {
			fields.putIfAbsent(FieldNames.toSnakeCase(error.getField()), ConstraintCodes.of(error.getCode()));
		}
		String message = fields.isEmpty() ? "Request body is not valid"
				: describe(fields.keySet().iterator().next(), fields.values().iterator().next());
		return respond(new ValidationException(message, fields));
	}

	@ExceptionHandler(HandlerMethodValidationException.class)
	ResponseEntity<ApiResponse<Void>> handleInvalidParameters(HandlerMethodValidationException ex) {
		Map<String, String> fields = new LinkedHashMap<>();
		ex.getParameterValidationResults()
			.forEach(result -> result.getResolvableErrors()
				.forEach(error -> fields.putIfAbsent(FieldNames.toSnakeCase(result.getMethodParameter().getParameterName()),
						ConstraintCodes.of(error.getCodes() == null || error.getCodes().length == 0 ? null
								: lastSegment(error.getCodes()[error.getCodes().length - 1])))));
		return respond(new ValidationException("Request parameters are not valid", fields));
	}

	@ExceptionHandler(ConstraintViolationException.class)
	ResponseEntity<ApiResponse<Void>> handleConstraintViolation(ConstraintViolationException ex) {
		Map<String, String> fields = new LinkedHashMap<>();
		ex.getConstraintViolations()
			.forEach(v -> fields.putIfAbsent(FieldNames.toSnakeCase(lastSegment(v.getPropertyPath().toString())),
					ConstraintCodes.of(v.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName())));
		return respond(new ValidationException("Request is not valid", fields));
	}

	@ExceptionHandler({ HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class })
	ResponseEntity<ApiResponse<Void>> handleUnreadable(Exception ex) {
		return respond(new ValidationException("Request body is not valid JSON", Map.of()));
	}

	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	ResponseEntity<ApiResponse<Void>> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
		String field = FieldNames.toSnakeCase(ex.getName());
		return respond(new ValidationException(field + " is not valid", Map.of(field, ConstraintCodes.INVALID)));
	}

	@ExceptionHandler(MissingServletRequestParameterException.class)
	ResponseEntity<ApiResponse<Void>> handleMissingParameter(MissingServletRequestParameterException ex) {
		String field = FieldNames.toSnakeCase(ex.getParameterName());
		return respond(new ValidationException(describe(field, ConstraintCodes.REQUIRED),
				Map.of(field, ConstraintCodes.REQUIRED)));
	}

	@ExceptionHandler(MissingRequestHeaderException.class)
	ResponseEntity<ApiResponse<Void>> handleMissingHeader(MissingRequestHeaderException ex) {
		return respond(new ValidationException(ex.getHeaderName() + " header is required",
				Map.of(ex.getHeaderName(), ConstraintCodes.REQUIRED)));
	}

	@ExceptionHandler({ NoResourceFoundException.class, HttpRequestMethodNotSupportedException.class })
	ResponseEntity<ApiResponse<Void>> handleNoRoute(Exception ex) {
		return respond(new NotFoundException());
	}

	@ExceptionHandler(AccessDeniedException.class)
	ResponseEntity<ApiResponse<Void>> handleAccessDenied(AccessDeniedException ex) {
		return respond(new ApiException(ErrorCode.FORBIDDEN, "Not allowed"));
	}

	@ExceptionHandler(DataAccessException.class)
	ResponseEntity<ApiResponse<Void>> handleDatabase(DataAccessException ex) {
		return databaseErrors.translate(ex).map(this::respond).orElseGet(() -> internalError(ex));
	}

	@ExceptionHandler(Exception.class)
	ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception ex) {
		return databaseErrors.translate(ex).map(this::respond).orElseGet(() -> internalError(ex));
	}

	private ResponseEntity<ApiResponse<Void>> internalError(Exception ex) {
		log.error("Unexpected error", ex);
		return respond(new ApiException(ErrorCode.INTERNAL_ERROR, "Something went wrong, please try again"));
	}

	private ResponseEntity<ApiResponse<Void>> respond(ApiException ex) {
		ApiError error = new ApiError(ex.code().name(), ex.getMessage(), ex.fields(), ex.retryAfterSeconds());
		ResponseEntity.BodyBuilder builder = ResponseEntity.status(ex.code().status());
		if (ex.retryAfterSeconds() != null) {
			builder.header(HttpHeaders.RETRY_AFTER, String.valueOf(ex.retryAfterSeconds()));
		}
		return builder.body(ApiResponse.failure(error));
	}

	private static String describe(String field, String code) {
		return switch (code) {
			case ConstraintCodes.REQUIRED -> field + " is required";
			case ConstraintCodes.INVALID_LENGTH -> field + " has the wrong length";
			case ConstraintCodes.OUT_OF_RANGE -> field + " is out of range";
			case ConstraintCodes.INVALID_FORMAT -> field + " has the wrong format";
			default -> field + " is not valid";
		};
	}

	private static String lastSegment(String path) {
		int dot = path.lastIndexOf('.');
		return dot < 0 ? path : path.substring(dot + 1);
	}

}
