package com.fullstar.api.common.claude;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.ContentBlock;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.TextBlock;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.resilience.Dependency;
import com.fullstar.api.common.resilience.ResilientCalls;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

/**
 * Claude through the official anthropic-java SDK. Retry, timeout and circuit breaker come from
 * Resilience4j (instance claude), so the SDK's own retries are off. Without ANTHROPIC_API_KEY every
 * call answers 503 FEATURE_DISABLED.
 */
@Component
public class AnthropicClaudeClient implements ClaudeClient, DisposableBean {

	private static final Logger log = LoggerFactory.getLogger(AnthropicClaudeClient.class);

	private final AiProperties properties;

	private final ResilientCalls calls;

	private final AnthropicClient client;

	public AnthropicClaudeClient(AiProperties properties, ResilientCalls calls) {
		this.properties = properties;
		this.calls = calls;
		if (properties.apiKey() == null) {
			this.client = null;
		}
		else {
			AnthropicOkHttpClient.Builder builder = AnthropicOkHttpClient.builder()
				.apiKey(properties.apiKey())
				.maxRetries(0)
				.timeout(properties.timeout());
			if (properties.baseUrl() != null) {
				builder.baseUrl(properties.baseUrl());
			}
			this.client = builder.build();
		}
	}

	@Override
	public String complete(String system, String user) {
		if (client == null) {
			throw new ApiException(ErrorCode.FEATURE_DISABLED, "Claude is not set up: ANTHROPIC_API_KEY is not set");
		}
		MessageCreateParams params = MessageCreateParams.builder()
			.model(properties.model())
			.maxTokens(properties.maxTokens())
			.system(system)
			.addUserMessage(user)
			.build();
		Message message = calls.call(Dependency.CLAUDE, () -> client.messages().create(params));
		String text = message.content()
			.stream()
			.map(ContentBlock::text)
			.flatMap(java.util.Optional::stream)
			.map(TextBlock::text)
			.collect(Collectors.joining());
		log.info("Claude reply model={} stopReason={} chars={}", properties.model(),
				message.stopReason().map(Object::toString).orElse("none"), text.length());
		return text;
	}

	@Override
	public void destroy() {
		if (client != null) {
			client.close();
		}
	}

}
