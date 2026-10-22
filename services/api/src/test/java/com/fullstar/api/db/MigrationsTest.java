package com.fullstar.api.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class MigrationsTest extends DatabaseTestSupport {

	private static final List<String> UPDATED_AT_TABLES = List.of("families", "children", "staff_users", "topics",
			"catalog_books", "catalog_chapters", "content_items", "family_books", "family_chapters", "uploads", "pages",
			"activity_attempts", "reading_tests", "worksheets", "support_tickets");

	@Test
	void createsAllSchemaTablesOwnedByAppOwner() {
		List<List<Object>> tables = asSystem(c -> rows(c,
				"SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'app' ORDER BY tablename"));
		assertThat(tables).hasSize(37);
		assertThat(tables).allSatisfy(row -> assertThat(row.get(1)).isEqualTo("app_owner"));
	}

	@Test
	void everyTableHasRowLevelSecurityEnabledAndForced() {
		List<List<Object>> missing = asSystem(c -> rows(c, """
				SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
				 WHERE n.nspname = 'app' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)"""));
		assertThat(missing).isEmpty();
	}

	@Test
	void everyTableHasAPolicy() {
		List<List<Object>> withoutPolicy = asSystem(c -> rows(c, """
				SELECT t.tablename FROM pg_tables t
				 WHERE t.schemaname = 'app'
				   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'app' AND p.tablename = t.tablename)"""));
		assertThat(withoutPolicy).isEmpty();
	}

	@Test
	void seedsSubjectsAndClassSubjects() {
		List<List<Object>> subjects = asSystem(
				c -> rows(c, "SELECT id, code, active FROM app.subjects ORDER BY id"));
		assertThat(subjects).containsExactly(List.of(1, "english", true), List.of(2, "hindi", true),
				List.of(3, "maths", true), List.of(4, "evs", true),
				List.of(5, "computer", false));
		assertThat(systemCount("SELECT count(*) FROM app.class_subjects")).isEqualTo(20);
		assertThat(systemCount("SELECT count(*) FROM app.class_subjects WHERE subject_id = 5")).isZero();
	}

	@Test
	void updatedAtTriggerOnEveryListedTable() {
		List<List<Object>> triggers = asSystem(c -> rows(c, """
				SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
				  JOIN pg_proc p ON p.oid = t.tgfoid
				 WHERE p.proname = 'set_updated_at' ORDER BY c.relname"""));
		assertThat(triggers).extracting(row -> row.get(0)).containsExactlyInAnyOrderElementsOf(UPDATED_AT_TABLES);
	}

	@Test
	void rolesHaveTheSchemaAttributes() {
		List<List<Object>> roles = asSystem(c -> rows(c, """
				SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
				 WHERE rolname IN ('app_owner', 'app_api', 'app_system') ORDER BY rolname"""));
		assertThat(roles).containsExactly(List.of("app_api", false, false), List.of("app_owner", false, false),
				List.of("app_system", true, false));
	}

	@Test
	void appFunctionsAreNotExecutableByPublic() {
		List<List<Object>> publicFunctions = asSystem(c -> rows(c, """
				SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
				 WHERE n.nspname = 'app' AND has_function_privilege('public', p.oid, 'EXECUTE')"""));
		assertThat(publicFunctions).isEmpty();
	}

	@Test
	void flywayHistoryLivesOutsideTheAppSchema() {
		Long applied = inTransaction("app_owner", OWNER_PASSWORD, null, null, null, c -> count(c,
				"SELECT count(*) FROM flyway.flyway_schema_history WHERE success AND version IS NOT NULL"));
		assertThat(applied).isEqualTo(15);
	}

}
