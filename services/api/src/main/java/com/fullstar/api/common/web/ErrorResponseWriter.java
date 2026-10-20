package com.fullstar.api.common.web;

import com.fullstar.api.common.error.ApiException;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** Writes the §10 error envelope from filters, where the controller advice does not apply. */
@Component
public class ErrorResponseWriter {

	private final JsonMapper json;

	public ErrorResponseWriter(JsonMapper json) {
		this.json = json;
	}

	public void write(HttpServletResponse response, ApiException ex) throws IOException {
		response.resetBuffer();
		response.setStatus(ex.code().status().value());
		response.setContentType(MediaType.APPLICATION_JSON_VALUE);
		if (ex.retryAfterSeconds() != null) {
			response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(ex.retryAfterSeconds()));
		}
		ApiError error = new ApiError(ex.code().name(), ex.getMessage(), ex.fields(), ex.retryAfterSeconds());
		response.getOutputStream().write(json.writeValueAsBytes(ApiResponse.failure(error)));
	}

}
