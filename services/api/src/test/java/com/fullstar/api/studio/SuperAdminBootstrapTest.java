package com.fullstar.api.studio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fullstar.api.common.db.DataSourceConfig;
import com.fullstar.api.studio.staff.SuperAdminBootstrapRunner;
import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.FakeKeycloakAdmin;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** make bootstrap-admin (Plan 4.1): the first super admin, safe to run again. */
class SuperAdminBootstrapTest extends ApiTestSupport {

	@Autowired
	private FakeKeycloakAdmin keycloak;

	@Autowired
	@Qualifier(DataSourceConfig.SYSTEM)
	private JdbcTemplate system;

	@Autowired
	@Qualifier(DataSourceConfig.SYSTEM)
	private TransactionTemplate systemTransactions;

	private void run(String... args) {
		new SuperAdminBootstrapRunner(keycloak, system, systemTransactions).run(new DefaultApplicationArguments(args));
	}

	@Test
	void createsTheSuperAdminAndRestoresItOnASecondRun() {
		String email = "boss-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
		run("--email=" + email, "--name=Head Teacher");
		String keycloakUserId = keycloak.userId(email);
		assertThat(keycloak.role(keycloakUserId)).isEqualTo("super_admin");
		UUID id = system.queryForObject(
				"SELECT id FROM app.staff_users WHERE keycloak_user_id = ? AND role = 'super_admin' AND active", UUID.class,
				keycloakUserId);

		system.update("UPDATE app.staff_users SET role = 'content_admin', active = false WHERE id = ?", id);
		run("--email=" + email, "--name=Head Teacher");
		assertThat(system.queryForObject("SELECT role || ':' || active FROM app.staff_users WHERE id = ?", String.class, id))
			.isEqualTo("super_admin:true");
		assertThat(system.queryForObject("""
				SELECT count(*) FROM app.audit_log
				 WHERE action = 'staff.bootstrap' AND actor_type = 'system' AND entity_id = ?""", Long.class,
				id.toString()))
			.isEqualTo(2L);
	}

	@Test
	void refusesMissingOrBadArguments() {
		assertThatThrownBy(() -> run("--name=Head")).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> run("--email=nope", "--name=Head")).isInstanceOf(IllegalArgumentException.class);
	}

}
