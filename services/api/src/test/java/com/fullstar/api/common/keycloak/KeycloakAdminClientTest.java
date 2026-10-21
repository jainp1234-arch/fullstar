package com.fullstar.api.common.keycloak;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fullstar.api.common.db.RequestActor.StaffRole;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.resilience.ResilientCalls;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.RetryConfig;
import io.github.resilience4j.retry.RetryRegistry;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The admin REST calls against a stand-in Keycloak (JDK HTTP server). */
class KeycloakAdminClientTest {

	private static final String SECRET = "test-admin-secret-0123456789abcdef";

	private HttpServer server;

	private ResilientCalls calls;

	private KeycloakAdminClient client;

	/** email → user id */
	private final Map<String, String> users = new ConcurrentHashMap<>();

	/** user id → realm role names */
	private final Map<String, List<String>> mappings = new ConcurrentHashMap<>();

	private final List<String> requests = new CopyOnWriteArrayList<>();

	private final AtomicInteger tokens = new AtomicInteger();

	@BeforeEach
	void start() throws IOException {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/auth/", this::handle);
		server.start();
		calls = new ResilientCalls(CircuitBreakerRegistry.ofDefaults(),
				RetryRegistry.of(RetryConfig.custom()
					.maxAttempts(2)
					.waitDuration(Duration.ofMillis(1))
					.ignoreExceptions(CallNotPermittedException.class)
					.build()),
				TimeLimiterRegistry.ofDefaults());
		client = new KeycloakAdminClient(new KeycloakAdminProperties(
				"http://127.0.0.1:" + server.getAddress().getPort() + "/auth/", "fullstar", "fullstar-api-admin", SECRET),
				calls);
	}

	@AfterEach
	void stop() {
		server.stop(0);
		calls.destroy();
	}

	@Test
	void createsAMissingUserWithTotpRequiredAndReusesTheToken() {
		String id = client.ensureUser(" New.Teacher@Example.com ");
		assertThat(id).isEqualTo(users.get("new.teacher@example.com"));
		assertThat(requests).anyMatch(r -> r.startsWith("POST /auth/admin/realms/fullstar/users ")
				&& r.contains("\"requiredActions\":[\"CONFIGURE_TOTP\"]") && r.contains("new.teacher@example.com"));

		assertThat(client.ensureUser("new.teacher@example.com")).isEqualTo(id);
		assertThat(requests).filteredOn(r -> r.startsWith("POST /auth/admin/realms/fullstar/users ")).hasSize(1);
		assertThat(tokens).hasValue(1);
		assertThat(requests).filteredOn(r -> r.startsWith("POST /auth/realms/fullstar/protocol/openid-connect/token"))
			.singleElement()
			.satisfies(r -> assertThat(r).contains("grant_type=client_credentials").contains("client_id=fullstar-api-admin"));
	}

	@Test
	void findsAnExistingUserWithoutCreating() {
		users.put("teacher@example.com", "kc-1");
		assertThat(client.ensureUser("teacher@example.com")).isEqualTo("kc-1");
		assertThat(requests).noneMatch(r -> r.startsWith("POST /auth/admin/realms/fullstar/users "));
	}

	@Test
	void setStaffRoleKeepsExactlyOneStaffRole() {
		mappings.put("kc-1", new CopyOnWriteArrayList<>(List.of("default-roles-fullstar", "content_admin")));
		client.setStaffRole("kc-1", StaffRole.SUPER_ADMIN);
		assertThat(mappings.get("kc-1")).containsExactlyInAnyOrder("default-roles-fullstar", "super_admin");

		client.setStaffRole("kc-1", StaffRole.SUPER_ADMIN);
		assertThat(requests).filteredOn(r -> r.startsWith("POST /auth/admin/realms/fullstar/users/kc-1/role-mappings"))
			.hasSize(1);

		client.setStaffRole("kc-1", null);
		assertThat(mappings.get("kc-1")).containsExactly("default-roles-fullstar");
	}

	@Test
	void withoutASecretStaffManagementIsSwitchedOff() {
		KeycloakAdminClient off = new KeycloakAdminClient(new KeycloakAdminProperties(null, null, null, " "), calls);
		assertThatThrownBy(() -> off.ensureUser("a@example.com")).isInstanceOf(ApiException.class)
			.satisfies(ex -> assertThat(((ApiException) ex).code()).isEqualTo(ErrorCode.FEATURE_DISABLED));
	}

	@Test
	void keycloakDownBecomesDependencyUnavailable() {
		server.stop(0);
		assertThatThrownBy(() -> client.ensureUser("a@example.com")).isInstanceOf(ApiException.class)
			.satisfies(ex -> assertThat(((ApiException) ex).code()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE));
	}

	private void handle(HttpExchange exchange) throws IOException {
		String method = exchange.getRequestMethod();
		String path = exchange.getRequestURI().getPath();
		String query = exchange.getRequestURI().getRawQuery();
		String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
		requests.add(method + " " + path + " " + body);
		String admin = "/auth/admin/realms/fullstar/users";
		if (path.equals("/auth/realms/fullstar/protocol/openid-connect/token")) {
			if (!body.contains("client_secret=" + SECRET)) {
				reply(exchange, 401, "{}");
				return;
			}
			tokens.incrementAndGet();
			reply(exchange, 200, "{\"access_token\":\"admin-token\",\"expires_in\":300}");
			return;
		}
		if (!"Bearer admin-token".equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
			reply(exchange, 401, "{}");
			return;
		}
		if (path.equals(admin) && method.equals("GET")) {
			String email = java.net.URLDecoder.decode(query.replaceAll(".*email=([^&]*).*", "$1"), StandardCharsets.UTF_8);
			String id = users.get(email);
			reply(exchange, 200, id == null ? "[]" : "[{\"id\":\"" + id + "\",\"email\":\"" + email + "\"}]");
			return;
		}
		if (path.equals(admin) && method.equals("POST")) {
			String email = body.replaceAll(".*\"email\":\"([^\"]*)\".*", "$1");
			String id = "kc-" + (users.size() + 100);
			users.put(email, id);
			exchange.getResponseHeaders().add("Location", "http://keycloak" + admin + "/" + id);
			reply(exchange, 201, "");
			return;
		}
		String[] parts = path.substring(admin.length() + 1).split("/");
		List<String> roles = mappings.computeIfAbsent(parts[0], k -> new CopyOnWriteArrayList<>());
		if (parts.length == 4 && parts[3].equals("available")) {
			reply(exchange, 200, "[{\"id\":\"r-ca\",\"name\":\"content_admin\"},{\"id\":\"r-sa\",\"name\":\"super_admin\"}]");
		}
		else if (method.equals("GET")) {
			StringBuilder json = new StringBuilder("[");
			for (String role : roles) {
				json.append(json.length() > 1 ? "," : "").append("{\"id\":\"r-").append(role).append("\",\"name\":\"")
					.append(role).append("\"}");
			}
			reply(exchange, 200, json.append(']').toString());
		}
		else if (method.equals("POST")) {
			roles.add(body.replaceAll(".*\"name\":\"([^\"]*)\".*", "$1"));
			reply(exchange, 204, "");
		}
		else if (method.equals("DELETE")) {
			roles.removeIf(role -> body.contains("\"name\":\"" + role + "\""));
			reply(exchange, 204, "");
		}
		else {
			reply(exchange, 404, "{}");
		}
	}

	private static void reply(HttpExchange exchange, int status, String body) throws IOException {
		byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
		exchange.getResponseHeaders().add("Content-Type", "application/json");
		exchange.sendResponseHeaders(status, status == 204 || bytes.length == 0 ? -1 : bytes.length);
		if (bytes.length > 0) {
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(bytes);
			}
		}
		exchange.close();
	}

}
