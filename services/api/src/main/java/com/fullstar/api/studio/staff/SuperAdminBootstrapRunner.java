package com.fullstar.api.studio.staff;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.db.DataSourceConfig;
import com.fullstar.api.common.db.RequestActor.StaffRole;
import com.fullstar.api.common.keycloak.KeycloakAdmin;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * make bootstrap-admin EMAIL=… NAME=… (profile "bootstrap-admin", Plan 4.1): makes that person a
 * super admin in Keycloak and staff_users, so the first super admin can add everyone else in S13.
 * Safe to run again: an existing row becomes an active super admin. The application then exits.
 */
@Component
@Profile("bootstrap-admin")
public class SuperAdminBootstrapRunner implements ApplicationRunner {

	private static final Logger log = LoggerFactory.getLogger(SuperAdminBootstrapRunner.class);

	private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

	private final KeycloakAdmin keycloak;

	private final JdbcTemplate system;

	private final TransactionTemplate systemTransactions;

	public SuperAdminBootstrapRunner(KeycloakAdmin keycloak, @Qualifier(DataSourceConfig.SYSTEM) JdbcTemplate system,
			@Qualifier(DataSourceConfig.SYSTEM) TransactionTemplate systemTransactions) {
		this.keycloak = keycloak;
		this.system = system;
		this.systemTransactions = systemTransactions;
	}

	@Override
	public void run(ApplicationArguments args) {
		String email = single(args, "email");
		String name = single(args, "name");
		if (!EMAIL.matcher(email).matches()) {
			throw new IllegalArgumentException("--email is not an email address");
		}
		if (name.length() > 80) {
			throw new IllegalArgumentException("--name must be at most 80 characters");
		}
		String keycloakUserId = keycloak.ensureUser(email);
		keycloak.setStaffRole(keycloakUserId, StaffRole.SUPER_ADMIN);
		UUID id = systemTransactions.execute(status -> {
			UUID staffId = system.queryForObject("""
					INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
					VALUES (?, ?, 'super_admin')
					ON CONFLICT (keycloak_user_id)
					DO UPDATE SET display_name = EXCLUDED.display_name, role = 'super_admin', active = true,
					              updated_at = now()
					RETURNING id""", UUID.class, keycloakUserId, name);
			AuditLog.system(system, "staff.bootstrap", "staff_user", staffId, Map.of("role", "super_admin"));
			return staffId;
		});
		log.info("Super admin ready staffId={}", id);
	}

	private static String single(ApplicationArguments args, String option) {
		List<String> values = args.getOptionValues(option);
		if (values == null || values.size() != 1 || values.get(0).isBlank()) {
			throw new IllegalArgumentException("Pass exactly one --" + option + "=…");
		}
		return values.get(0).strip();
	}

}
