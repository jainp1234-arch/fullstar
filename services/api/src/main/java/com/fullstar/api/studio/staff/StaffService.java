package com.fullstar.api.studio.staff;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.db.RequestActor.StaffRole;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.keycloak.KeycloakAdmin;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Staff users and roles (Schema §11 /studio/staff, super admin only; RLS allows writes only to super
 * admins). The Keycloak realm role is changed first, so a failed Keycloak call changes nothing here.
 */
@Service
public class StaffService {

	private static final Logger log = LoggerFactory.getLogger(StaffService.class);

	private static final String COLUMNS = "id, display_name, role, active, created_at";

	private final JdbcTemplate jdbc;

	private final KeycloakAdmin keycloak;

	private final AuditLog audit;

	public StaffService(JdbcTemplate jdbc, KeycloakAdmin keycloak, AuditLog audit) {
		this.jdbc = jdbc;
		this.keycloak = keycloak;
		this.audit = audit;
	}

	public record Staff(UUID id, String displayName, String role, boolean active, Instant createdAt) {
	}

	/** Absent fields are null and stay unchanged. */
	public record Change(String displayName, StaffRole role, Boolean active) {
	}

	public List<Staff> list() {
		return jdbc.query("SELECT " + COLUMNS + " FROM app.staff_users ORDER BY active DESC, display_name, id",
				StaffService::staff);
	}

	public Staff create(UUID actorId, String email, String displayName, StaffRole role) {
		String keycloakUserId = keycloak.ensureUser(email);
		Integer known = jdbc.queryForObject("SELECT count(*) FROM app.staff_users WHERE keycloak_user_id = ?",
				Integer.class, keycloakUserId);
		if (known != null && known > 0) {
			throw new ApiException(ErrorCode.CONFLICT, "This person is already on the staff list");
		}
		keycloak.setStaffRole(keycloakUserId, role);
		Staff created = jdbc.queryForObject("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, ?, ?) RETURNING %s""".formatted(COLUMNS), StaffService::staff, keycloakUserId, displayName,
				role.dbValue());
		audit.staff(actorId, "staff.create", "staff_user", created.id(), Map.of("role", created.role()));
		log.info("Staff user created staffId={} role={}", created.id(), created.role());
		return created;
	}

	public Staff update(UUID actorId, UUID id, Change change) {
		List<Current> rows = jdbc.query(
				"SELECT keycloak_user_id, role, active FROM app.staff_users WHERE id = ? FOR UPDATE",
				(rs, n) -> new Current(rs.getString("keycloak_user_id"), rs.getString("role"), rs.getBoolean("active")),
				id);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Current current = rows.get(0);
		String role = change.role() == null ? current.role() : change.role().dbValue();
		boolean active = change.active() == null ? current.active() : change.active();
		boolean access = !role.equals(current.role()) || active != current.active();
		if (access && id.equals(actorId)) {
			// Keeps at least one super admin: nobody can demote or switch off themselves
			throw new ApiException(ErrorCode.CONFLICT, "You can't change your own role or switch yourself off");
		}
		if (access) {
			keycloak.setStaffRole(current.keycloakUserId(), active ? StaffRole.valueOf(role.toUpperCase(Locale.ROOT)) : null);
		}
		Staff updated = jdbc.queryForObject("""
				UPDATE app.staff_users
				   SET display_name = COALESCE(?, display_name), role = ?, active = ?, updated_at = now()
				 WHERE id = ? RETURNING %s""".formatted(COLUMNS), StaffService::staff, change.displayName(), role, active, id);
		Map<String, Object> metadata = new LinkedHashMap<>();
		metadata.put("role", role);
		metadata.put("active", active);
		metadata.put("name_changed", change.displayName() != null);
		audit.staff(actorId, "staff.update", "staff_user", id, metadata);
		log.info("Staff user updated staffId={} role={} active={}", id, role, active);
		return updated;
	}

	private record Current(String keycloakUserId, String role, boolean active) {
	}

	private static Staff staff(ResultSet rs, int n) throws SQLException {
		return new Staff(rs.getObject("id", UUID.class), rs.getString("display_name"), rs.getString("role"),
				rs.getBoolean("active"), rs.getTimestamp("created_at").toInstant());
	}

}
