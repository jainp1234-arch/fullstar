package com.fullstar.api.testsupport;

import java.nio.file.Path;
import org.flywaydb.core.Flyway;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.Container.ExecResult;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.MountableFile;

/**
 * One PostgreSQL 18 container per test run, prepared exactly like Neon: infra/db/bootstrap-roles.sql
 * as the database owner, then every Flyway migration as app_owner.
 */
public final class TestDatabase {

	public static final String OWNER_PASSWORD = "owner-test-password";

	public static final String API_PASSWORD = "api-test-password";

	public static final String SYSTEM_PASSWORD = "system-test-password";

	public static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18.6")
		.withDatabaseName("fullstar")
		.withCopyFileToContainer(
				MountableFile.forHostPath(Path.of("../../infra/db/bootstrap-roles.sql").toAbsolutePath()),
				"/tmp/bootstrap-roles.sql");

	static {
		POSTGRES.start();
		bootstrapRoles();
		Flyway.configure()
			.dataSource(POSTGRES.getJdbcUrl(), "app_owner", OWNER_PASSWORD)
			.schemas("flyway")
			.defaultSchema("flyway")
			.locations("classpath:db/migration")
			.load()
			.migrate();
	}

	private TestDatabase() {
	}

	public static String jdbcUrl() {
		return POSTGRES.getJdbcUrl();
	}

	/** Points both application pools at the container (app_api pool of one connection, to catch leaks). */
	public static void register(DynamicPropertyRegistry registry) {
		registry.add("fullstar.datasource.api.jdbc-url", TestDatabase::jdbcUrl);
		registry.add("fullstar.datasource.api.password", () -> API_PASSWORD);
		registry.add("fullstar.datasource.api.maximum-pool-size", () -> "1");
		registry.add("fullstar.datasource.system.jdbc-url", TestDatabase::jdbcUrl);
		registry.add("fullstar.datasource.system.password", () -> SYSTEM_PASSWORD);
	}

	private static void bootstrapRoles() {
		try {
			ExecResult result = POSTGRES.execInContainer("sh", "-c",
					"APP_OWNER_PASSWORD=" + OWNER_PASSWORD + " APP_API_PASSWORD=" + API_PASSWORD
							+ " APP_SYSTEM_PASSWORD=" + SYSTEM_PASSWORD + " psql -X -q -U " + POSTGRES.getUsername()
							+ " -d fullstar -f /tmp/bootstrap-roles.sql");
			if (result.getExitCode() != 0) {
				throw new IllegalStateException("bootstrap-roles.sql failed: " + result.getStderr());
			}
		}
		catch (Exception ex) {
			throw new IllegalStateException("Could not bootstrap roles", ex);
		}
	}

}
