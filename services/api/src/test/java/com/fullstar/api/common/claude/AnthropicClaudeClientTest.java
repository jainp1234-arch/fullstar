package com.fullstar.api.common.claude;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.resilience.ResilientCalls;
import com.sun.net.httpserver.HttpServer;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.RetryConfig;
import io.github.resilience4j.retry.RetryRegistry;
import io.github.resilience4j.timelimiter.TimeLimiterConfig;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The SDK client against a stand-in Messages API (JDK HTTP server). */
class AnthropicClaudeClientTest {

	private static final String REPLY = """
			{ "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
			  "content": [ { "type": "text", "text": "{\\"title\\": " }, { "type": "text", "text": "\\"Nests\\"}" } ],
			  "stop_reason": "end_turn", "stop_sequence": null,
			  "usage": { "input_tokens": 10, "output_tokens": 5 } }""";

	private HttpServer server;

	private ResilientCalls calls;

	private final List<String> requests = new CopyOnWriteArrayList<>();

	private final AtomicInteger failures = new AtomicInteger();

	@BeforeEach
	void start() throws Exception {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/v1/messages", exchange -> {
			String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
			requests.add(exchange.getRequestHeaders().getFirst("x-api-key") + " " + body);
			boolean fail = failures.getAndUpdate(n -> Math.max(0, n - 1)) > 0;
			byte[] out = (fail ? "{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"busy\"}}"
					: REPLY).getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().add("Content-Type", "application/json");
			exchange.sendResponseHeaders(fail ? 529 : 200, out.length);
			try (OutputStream stream = exchange.getResponseBody()) {
				stream.write(out);
			}
		});
		server.start();
		calls = new ResilientCalls(CircuitBreakerRegistry.ofDefaults(),
				RetryRegistry.of(RetryConfig.custom()
					.maxAttempts(2)
					.waitDuration(Duration.ofMillis(1))
					.ignoreExceptions(CallNotPermittedException.class)
					.build()),
				TimeLimiterRegistry.of(TimeLimiterConfig.custom().timeoutDuration(Duration.ofSeconds(20)).build()));
	}

	@AfterEach
	void stop() {
		server.stop(0);
		calls.destroy();
	}

	private AnthropicClaudeClient client(String key) {
		return new AnthropicClaudeClient(new AiProperties("true", "false", key, "claude-test-model", 1000,
				Duration.ofSeconds(5), "http://127.0.0.1:" + server.getAddress().getPort()), calls);
	}

	@Test
	void sendsTheConfiguredModelAndJoinsTheReplyText() {
		AnthropicClaudeClient client = client("test-key");
		assertThat(client.complete("You write lessons.", "Write one.")).isEqualTo("{\"title\": \"Nests\"}");
		assertThat(requests).singleElement()
			.satisfies(request -> assertThat(request).startsWith("test-key ")
				.contains("\"model\":\"claude-test-model\"")
				.contains("You write lessons.")
				.contains("Write one.")
				.contains("\"max_tokens\":1000"));
		client.destroy();
	}

	@Test
	void anOverloadedApiIsRetriedThenReportedUnavailable() {
		AnthropicClaudeClient client = client("test-key");
		failures.set(1);
		assertThat(client.complete("s", "u")).contains("Nests");
		assertThat(requests).hasSize(2);
		failures.set(5);
		assertThatThrownBy(() -> client.complete("s", "u")).isInstanceOf(ApiException.class)
			.satisfies(ex -> assertThat(((ApiException) ex).code()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
		client.destroy();
	}

	@Test
	void withoutAKeyClaudeIsSwitchedOff() {
		AnthropicClaudeClient client = client(" ");
		assertThatThrownBy(() -> client.complete("s", "u")).isInstanceOf(ApiException.class)
			.satisfies(ex -> assertThat(((ApiException) ex).code()).isEqualTo(ErrorCode.FEATURE_DISABLED));
		assertThat(requests).isEmpty();
	}

	@Test
	void flagsAreOnOnlyWhenTrue() {
		assertThat(new AiProperties("true", " TRUE ", null, null, null, null, null).checkEnabled()).isTrue();
		AiProperties off = new AiProperties("", "yes", null, null, null, null, null);
		assertThat(off.draftsEnabled()).isFalse();
		assertThat(off.checkEnabled()).isFalse();
		assertThat(off.model()).isEqualTo("claude-sonnet-5-5");
		assertThat(off.toString()).doesNotContain("key=").contains("apiKey=unset");
	}

}
