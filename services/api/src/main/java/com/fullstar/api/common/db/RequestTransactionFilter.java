package com.fullstar.api.common.db;

import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.DatabaseErrorTranslator;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.web.ErrorResponseWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * Every API request runs in one app_api transaction that first sets the RLS session values
 * (Schema §1 rule 3, §7). Error responses roll back. The response is buffered and sent only after
 * the commit, so a failed commit never leaves a success response on the wire.
 */
public class RequestTransactionFilter extends OncePerRequestFilter {

	private static final Logger log = LoggerFactory.getLogger(RequestTransactionFilter.class);

	private final TransactionTemplate transactions;

	private final ActorResolver actors;

	private final RlsSession rlsSession;

	private final IdempotencyHandler idempotency;

	private final DatabaseErrorTranslator databaseErrors;

	private final ErrorResponseWriter errorWriter;

	public RequestTransactionFilter(TransactionTemplate transactions, ActorResolver actors, RlsSession rlsSession,
			IdempotencyHandler idempotency, DatabaseErrorTranslator databaseErrors, ErrorResponseWriter errorWriter) {
		this.transactions = transactions;
		this.actors = actors;
		this.rlsSession = rlsSession;
		this.idempotency = idempotency;
		this.databaseErrors = databaseErrors;
		this.errorWriter = errorWriter;
	}

	/** Health must answer even when the database is down, so it runs outside the transaction. */
	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return "/api/v1/public/health".equals(request.getRequestURI());
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		ContentCachingResponseWrapper buffered = new ContentCachingResponseWrapper(response);
		try {
			RequestActor actor = actors.resolve(request);
			transactions.executeWithoutResult(status -> {
				rlsSession.apply(actor);
				try {
					idempotency.handle(request, buffered, actor, () -> chain.doFilter(request, buffered));
				}
				catch (RuntimeException ex) {
					throw ex;
				}
				catch (Exception ex) {
					throw new FilterChainFailure(ex);
				}
				if (buffered.getStatus() >= 400) {
					status.setRollbackOnly();
				}
			});
		}
		catch (ApiException ex) {
			errorWriter.write(buffered, ex);
		}
		catch (FilterChainFailure ex) {
			if (ex.getCause() instanceof IOException io) {
				throw io;
			}
			if (ex.getCause() instanceof ServletException servlet) {
				throw servlet;
			}
			throw new ServletException(ex.getCause());
		}
		catch (RuntimeException ex) {
			ApiException translated = databaseErrors.translate(ex).orElse(null);
			if (translated == null) {
				log.error("Request transaction failed", ex);
				translated = new ApiException(ErrorCode.INTERNAL_ERROR, "Something went wrong, please try again");
			}
			errorWriter.write(buffered, translated);
		}
		buffered.copyBodyToResponse();
	}

	/** Carries checked filter-chain exceptions out of the transaction callback. */
	private static final class FilterChainFailure extends RuntimeException {

		FilterChainFailure(Exception cause) {
			super(cause);
		}

	}

}
