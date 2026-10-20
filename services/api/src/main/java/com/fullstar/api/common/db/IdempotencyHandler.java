package com.fullstar.api.common.db;

import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.ValidationException;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * Idempotency-Key support (Schema §10, V12). Runs inside the request transaction: the key is
 * claimed, the request runs, and a 2xx response is stored, all in one commit. A repeat with the
 * same key and request returns the stored response; a failed request rolls back its claim.
 */
@Component
public class IdempotencyHandler {

	public static final String HEADER = "Idempotency-Key";

	public static final String REPLAYED_HEADER = "Idempotent-Replayed";

	private static final Set<String> WRITE_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");

	private final JdbcTemplate jdbc;

	public IdempotencyHandler(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@FunctionalInterface
	public interface RequestWork {

		void run() throws Exception;

	}

	public void handle(HttpServletRequest request, ContentCachingResponseWrapper response, RequestActor actor,
			RequestWork work) throws Exception {
		String header = request.getHeader(HEADER);
		String owner = actor.idempotencyOwner();
		if (header == null || owner == null || !WRITE_METHODS.contains(request.getMethod())) {
			work.run();
			return;
		}
		String key = parseKey(header);
		String requestLine = request.getMethod() + " " + request.getRequestURI();

		int claimed = jdbc.update("""
				INSERT INTO app.processed_jobs (idempotency_key, job_type, owner, request)
				VALUES (?, 'http', ?, ?) ON CONFLICT (idempotency_key) DO NOTHING""", key, owner, requestLine);
		if (claimed == 1) {
			work.run();
			storeIfSuccessful(key, response);
			return;
		}
		replay(key, requestLine, response);
	}

	private void storeIfSuccessful(String key, ContentCachingResponseWrapper response) {
		int status = response.getStatus();
		if (status < 200 || status >= 300) {
			return; // the request transaction rolls back, releasing the key
		}
		byte[] body = response.getContentAsByteArray();
		String json = body.length == 0 ? null : new String(body, StandardCharsets.UTF_8);
		jdbc.update("UPDATE app.processed_jobs SET response_status = ?, response_body = ? WHERE idempotency_key = ?",
				(short) status, json, key);
	}

	private void replay(String key, String requestLine, ContentCachingResponseWrapper response) throws IOException {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT request, response_status, response_body AS body FROM app.processed_jobs
				 WHERE idempotency_key = ?""", key);
		if (rows.isEmpty() || !requestLine.equals(rows.get(0).get("request"))
				|| rows.get(0).get("response_status") == null) {
			throw new ApiException(ErrorCode.CONFLICT, "This Idempotency-Key was already used for a different request");
		}
		Map<String, Object> row = rows.get(0);
		response.setStatus(((Number) row.get("response_status")).intValue());
		response.setHeader(REPLAYED_HEADER, "true");
		Object body = row.get("body");
		if (body != null) {
			response.setContentType(MediaType.APPLICATION_JSON_VALUE);
			response.getOutputStream().write(((String) body).getBytes(StandardCharsets.UTF_8));
		}
	}

	private static String parseKey(String header) {
		try {
			return UUID.fromString(header.trim()).toString();
		}
		catch (IllegalArgumentException ex) {
			throw new ValidationException(HEADER + " must be a UUID", Map.of(HEADER, "INVALID_FORMAT"));
		}
	}

}
