package com.fullstar.api.testsupport;

import com.fullstar.api.common.db.ActorResolver;
import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.security.JwtActorResolver;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** Full application against {@link TestDatabase}, called through MockMvc with every servlet filter. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(ApiTestSupport.TestApiConfig.class)
public abstract class ApiTestSupport {

	/** "parent:<family uuid>" or "staff:content_admin" / "staff:super_admin"; absent = anonymous. */
	public static final String ACTOR_HEADER = "X-Test-Actor";

	@Autowired
	protected MockMvc mvc;

	@DynamicPropertySource
	static void database(DynamicPropertyRegistry registry) {
		TestDatabase.register(registry);
		TestTokens.register(registry);
	}

	protected static String parent(UUID familyId) {
		return "parent:" + familyId;
	}

	protected static UUID newFamily() {
		return systemQuery("""
				INSERT INTO app.families (keycloak_user_id, consent_version, consent_at)
				VALUES (?, 'v1', now()) RETURNING id""", "kc-" + UUID.randomUUID());
	}

	protected static long countUsageEvents(String eventType) {
		Long count = systemQuery("SELECT count(*) FROM app.usage_events WHERE event_type = ?", eventType);
		return count;
	}

	@SuppressWarnings("unchecked")
	protected static <T> T systemQuery(String sql, Object... params) {
		try (Connection c = DriverManager.getConnection(TestDatabase.jdbcUrl(), "app_system", TestDatabase.SYSTEM_PASSWORD);
				PreparedStatement statement = c.prepareStatement(sql)) {
			for (int i = 0; i < params.length; i++) {
				statement.setObject(i + 1, params[i]);
			}
			try (ResultSet rs = statement.executeQuery()) {
				rs.next();
				return (T) rs.getObject(1);
			}
		}
		catch (SQLException ex) {
			throw new IllegalStateException(ex);
		}
	}

	@TestConfiguration(proxyBeanMethods = false)
	static class TestApiConfig {

		/** X-Test-Actor for the test endpoints; otherwise the real JWT resolver. */
		@Bean
		@Primary
		ActorResolver headerActorResolver(JwtActorResolver jwtActorResolver) {
			return request -> {
				String header = request.getHeader(ACTOR_HEADER);
				if (header == null) {
					return jwtActorResolver.resolve(request);
				}
				String[] parts = header.split(":", 2);
				return switch (parts[0]) {
					case "parent" -> RequestActor.parent(UUID.fromString(parts[1]));
					case "staff" -> RequestActor.staff(RequestActor.StaffRole.valueOf(parts[1].toUpperCase(Locale.ROOT)));
					default -> throw new IllegalArgumentException("Unknown test actor " + header);
				};
			};
		}

		/** The test endpoints have no sign-in yet (step 1.5 adds it). */
		@Bean
		@Order(Ordered.HIGHEST_PRECEDENCE)
		SecurityFilterChain testEndpoints(HttpSecurity http) throws Exception {
			http.securityMatcher("/api/v1/test/**")
				.csrf(csrf -> csrf.disable())
				.authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
			return http.build();
		}

	}

}
