package com.fullstar.api.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import com.fullstar.api.testsupport.TestDatabase;

/**
 * Database tests through plain JDBC, as app_api (RLS) or app_system (BYPASSRLS), always inside one
 * transaction with the Schema §7 session values. The database is {@link TestDatabase}.
 */
abstract class DatabaseTestSupport {

	static final String OWNER_PASSWORD = TestDatabase.OWNER_PASSWORD;

	static final String API_PASSWORD = TestDatabase.API_PASSWORD;

	static final String SYSTEM_PASSWORD = TestDatabase.SYSTEM_PASSWORD;

	@FunctionalInterface
	interface SqlWork<T> {

		T run(Connection connection) throws SQLException;

	}

	static Connection connect(String role, String password) throws SQLException {
		return DriverManager.getConnection(TestDatabase.jdbcUrl(), role, password);
	}

	static <T> T inTransaction(String role, String password, String actor, UUID familyId, String staffRole,
			SqlWork<T> work) {
		try (Connection connection = connect(role, password)) {
			connection.setAutoCommit(false);
			try {
				setLocal(connection, "app.actor", actor);
				setLocal(connection, "app.family_id", familyId == null ? null : familyId.toString());
				setLocal(connection, "app.staff_role", staffRole);
				T result = work.run(connection);
				connection.commit();
				return result;
			}
			catch (SQLException | RuntimeException ex) {
				connection.rollback();
				throw ex;
			}
		}
		catch (SQLException ex) {
			throw new DbException(ex);
		}
	}

	private static void setLocal(Connection connection, String name, String value) throws SQLException {
		if (value == null) {
			return;
		}
		try (PreparedStatement statement = connection.prepareStatement("SELECT set_config(?, ?, true)")) {
			statement.setString(1, name);
			statement.setString(2, value);
			statement.execute();
		}
	}

	static <T> T asSystem(SqlWork<T> work) {
		return inTransaction("app_system", SYSTEM_PASSWORD, null, null, null, work);
	}

	static <T> T asParent(UUID familyId, SqlWork<T> work) {
		return inTransaction("app_api", API_PASSWORD, "parent", familyId, null, work);
	}

	static <T> T asStaff(String staffRole, SqlWork<T> work) {
		return inTransaction("app_api", API_PASSWORD, "staff", null, staffRole, work);
	}

	static int exec(Connection connection, String sql, Object... params) throws SQLException {
		try (PreparedStatement statement = prepare(connection, sql, params)) {
			return statement.executeUpdate();
		}
	}

	static List<List<Object>> rows(Connection connection, String sql, Object... params) throws SQLException {
		try (PreparedStatement statement = prepare(connection, sql, params); ResultSet rs = statement.executeQuery()) {
			List<List<Object>> result = new ArrayList<>();
			int columns = rs.getMetaData().getColumnCount();
			while (rs.next()) {
				List<Object> row = new ArrayList<>();
				for (int i = 1; i <= columns; i++) {
					row.add(rs.getObject(i));
				}
				result.add(row);
			}
			return result;
		}
	}

	static Object value(Connection connection, String sql, Object... params) throws SQLException {
		List<List<Object>> result = rows(connection, sql, params);
		assertThat(result).as("rows for: %s", sql).hasSize(1);
		return result.get(0).get(0);
	}

	static long count(Connection connection, String sql, Object... params) throws SQLException {
		return ((Number) value(connection, sql, params)).longValue();
	}

	static Object systemValue(String sql, Object... params) {
		Object result = asSystem(c -> value(c, sql, params));
		return result;
	}

	static long systemCount(String sql, Object... params) {
		Long result = asSystem(c -> count(c, sql, params));
		return result;
	}

	private static PreparedStatement prepare(Connection connection, String sql, Object... params)
			throws SQLException {
		PreparedStatement statement = connection.prepareStatement(sql);
		for (int i = 0; i < params.length; i++) {
			statement.setObject(i + 1, params[i]);
		}
		return statement;
	}

	/** Asserts the work fails with the Schema error code raised as P0001 (or the given SQLSTATE). */
	static void assertDbError(String code, String sqlState, Runnable work) {
		assertThatThrownBy(work::run).isInstanceOf(DbException.class).satisfies(ex -> {
			SQLException cause = (SQLException) ex.getCause();
			assertThat(cause.getSQLState()).isEqualTo(sqlState);
			assertThat(cause.getMessage()).contains(code);
		});
	}

	static void assertDbError(String code, Runnable work) {
		assertDbError(code, "P0001", work);
	}

	static final class DbException extends RuntimeException {

		DbException(SQLException cause) {
			super(cause.getMessage(), cause);
		}

	}

	// ---- Fixtures (created as app_system, which bypasses RLS) ----

	static final short ENGLISH = 1;

	static final short MATHS = 3;

	static UUID newFamily() {
		return asSystem(c -> (UUID) value(c, """
				INSERT INTO app.families (keycloak_user_id, consent_version, consent_at)
				VALUES (?, 'v1', now()) RETURNING id""", "kc-" + UUID.randomUUID()));
	}

	static UUID newChild(UUID familyId, int classLevel) {
		return asSystem(c -> (UUID) value(c, """
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Asha', 8, ?, 'cat') RETURNING id""", familyId, (short) classLevel));
	}

	static UUID newStaff(String role) {
		return asSystem(c -> (UUID) value(c, """
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Staff', ?) RETURNING id""", "kc-" + UUID.randomUUID(), role));
	}

	static UUID newTopic(int classLevel, short subjectId) {
		return asSystem(c -> (UUID) value(c, """
				INSERT INTO app.topics (class_level, subject_id, name) VALUES (?, ?, ?) RETURNING id""",
				(short) classLevel, subjectId, "Topic " + UUID.randomUUID()));
	}

	static UUID newLibraryItem(String kind, UUID topicId, UUID staffId) {
		return asSystem(c -> (UUID) value(c, """
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang, created_by)
				VALUES (?, 'library', 3, 3, ?, ?, 'en', ?) RETURNING id""", kind, topicId,
				"question".equals(kind) ? "mcq" : null, staffId));
	}

	static UUID newVersion(UUID itemId, UUID staffId) {
		return asSystem(c -> (UUID) value(c, """
				INSERT INTO app.content_versions (item_id, title, body, created_by)
				VALUES (?, 'Title', '{}'::jsonb, ?) RETURNING id""", itemId, staffId));
	}

	/** Item with one version whose check passed, published (status and published_version_id set). */
	static UUID[] newPublishedLibraryItem(String kind, UUID topicId, UUID staffId) {
		UUID item = newLibraryItem(kind, topicId, staffId);
		UUID version = newVersion(item, staffId);
		asSystem(c -> exec(c, "INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual')",
				version));
		asSystem(c -> exec(c, """
				UPDATE app.content_items SET status = 'published', current_version_id = ?, published_version_id = ?,
				       published_at = now() WHERE id = ?""", version, version, item));
		return new UUID[] { item, version };
	}

	static UUID newFamilyBook(UUID familyId, int classLevel, short subjectId) {
		return asSystem(c -> (UUID) value(c, """
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, ?, ?, 'whole') RETURNING id""", familyId, subjectId, (short) classLevel));
	}

	static UUID newFamilyChapter(UUID familyId, UUID bookId, int number, String status) {
		return asSystem(c -> (UUID) value(c, """
				INSERT INTO app.family_chapters (family_book_id, family_id, number, title, status)
				VALUES (?, ?, ?, 'Chapter', ?) RETURNING id""", bookId, familyId, (short) number, status));
	}

	static UUID newAttempt(UUID familyId, UUID childId, String kind, int stars) {
		UUID id = UUID.randomUUID();
		asSystem(c -> exec(c, """
				INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, started_at, stars)
				VALUES (?, ?, ?, ?, 3, now(), ?)""", id, familyId, childId, kind, (short) stars));
		return id;
	}

}
