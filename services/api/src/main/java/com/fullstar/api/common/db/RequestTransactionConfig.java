package com.fullstar.api.common.db;

import com.fullstar.api.common.error.DatabaseErrorTranslator;
import com.fullstar.api.common.web.ErrorResponseWriter;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration(proxyBeanMethods = false)
public class RequestTransactionConfig {

	/** After Spring Security (order -100), so the actor can come from the authenticated token. */
	static final int ORDER = 0;

	@Bean
	FilterRegistrationBean<RequestTransactionFilter> requestTransactionFilter(TransactionTemplate transactionTemplate,
			ActorResolver actorResolver, RlsSession rlsSession, IdempotencyHandler idempotencyHandler,
			DatabaseErrorTranslator databaseErrorTranslator, ErrorResponseWriter errorResponseWriter) {
		RequestTransactionFilter filter = new RequestTransactionFilter(transactionTemplate, actorResolver, rlsSession,
				idempotencyHandler, databaseErrorTranslator, errorResponseWriter);
		FilterRegistrationBean<RequestTransactionFilter> registration = new FilterRegistrationBean<>(filter);
		registration.addUrlPatterns("/api/*");
		registration.setOrder(ORDER);
		return registration;
	}

}
