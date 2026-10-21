package com.fullstar.api.common.audit;

import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Writes app.audit_log rows (Schema §4.7) in the request transaction, so the row exists only if the
 * action commits. RLS lets staff insert only actor_type 'staff'. Metadata never holds personal data.
 */
@Component
public class AuditLog {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JdbcTemplate jdbc;

	public AuditLog(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public void staff(UUID staffId, String action, String entityType, Object entityId, Map<String, ?> metadata) {
		write(jdbc, "staff", staffId == null ? null : staffId.toString(), action, entityType, entityId, metadata);
	}

	/** For commands without a signed-in actor (bootstrap), on the app_system connection. */
	public static void system(JdbcTemplate system, String action, String entityType, Object entityId,
			Map<String, ?> metadata) {
		write(system, "system", null, action, entityType, entityId, metadata);
	}

	private static void write(JdbcTemplate jdbc, String actorType, String actorId, String action, String entityType,
			Object entityId, Map<String, ?> metadata) {
		jdbc.update("""
				INSERT INTO app.audit_log (actor_type, actor_id, action, entity_type, entity_id, metadata)
				VALUES (?, ?, ?, ?, ?, ?::jsonb)""", actorType, actorId, action, entityType,
				entityId == null ? null : entityId.toString(), JSON.writeValueAsString(metadata == null ? Map.of() : metadata));
	}

}
