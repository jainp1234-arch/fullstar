package com.fullstar.api.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * One structured log line per request with a request id (X-Request-Id). Logs method, path,
 * status and duration only: no query strings, bodies, names or other personal data (Tech Stack §10).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestLoggingFilter extends OncePerRequestFilter {

	public static final String HEADER = "X-Request-Id";

	private static final Logger log = LoggerFactory.getLogger(RequestLoggingFilter.class);

	private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		String incoming = request.getHeader(HEADER);
		String requestId = incoming != null && SAFE_ID.matcher(incoming).matches() ? incoming : UUID.randomUUID().toString();
		long start = System.nanoTime();
		MDC.put("request_id", requestId);
		response.setHeader(HEADER, requestId);
		try {
			chain.doFilter(request, response);
		}
		finally {
			long millis = (System.nanoTime() - start) / 1_000_000;
			log.atInfo()
				.addKeyValue("http_method", request.getMethod())
				.addKeyValue("url_path", request.getRequestURI())
				.addKeyValue("http_status", response.getStatus())
				.addKeyValue("duration_ms", millis)
				.log("request");
			MDC.remove("request_id");
		}
	}

}
