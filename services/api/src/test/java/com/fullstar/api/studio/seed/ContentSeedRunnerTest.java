package com.fullstar.api.studio.seed;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.db.DataSourceConfig;
import com.fullstar.api.common.db.RlsSession;
import com.fullstar.api.studio.check.ContentCheckService;
import com.fullstar.api.studio.check.PublishService;
import com.fullstar.api.studio.content.ContentService;
import com.fullstar.api.studio.content.TopicService;
import com.fullstar.api.testsupport.ApiTestSupport;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** make seed-content (Plan 4.5): everything is created, checked and published once; a rerun skips it all. */
class ContentSeedRunnerTest extends ApiTestSupport {

	@Autowired
	private JdbcTemplate jdbc;

	@Autowired
	@Qualifier(DataSourceConfig.SYSTEM)
	private JdbcTemplate system;

	@Autowired
	private TransactionTemplate transactions;

	@Autowired
	private RlsSession rls;

	@Autowired
	private TopicService topics;

	@Autowired
	private ContentService content;

	@Autowired
	private ContentCheckService checks;

	@Autowired
	private PublishService publishing;

	@Autowired
	private AuditLog audit;

	@Test
	void seedsClass3OnceAndPublishesEverything() {
		UUID admin = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Seeder', 'super_admin') RETURNING id""", UUID.randomUUID().toString());
		ContentSeedRunner runner = new ContentSeedRunner(jdbc, system, transactions, rls, topics, content, checks,
				publishing, audit);
		Path dir = Path.of("../../infra/seed/class3");

		ContentSeedRunner.Totals first = runner.seed(dir, admin);
		assertThat(first.created()).isEqualTo(230);

		Long published = systemQuery("""
				SELECT count(*) FROM app.content_items ci JOIN app.audit_log a
				    ON a.entity_id = ci.id::text AND a.action = 'content.seed' AND a.actor_id = ?
				 WHERE ci.status = 'published' AND ci.published_version_id = ci.current_version_id""", admin.toString());
		assertThat(published).isEqualTo(230L);
		Long lessons = systemQuery("""
				SELECT count(*) FROM app.content_items ci JOIN app.audit_log a
				    ON a.entity_id = ci.id::text AND a.action = 'content.seed' AND a.actor_id = ?
				 WHERE ci.kind = 'lesson' AND ci.class_level = 3""", admin.toString());
		assertThat(lessons).isEqualTo(20L);

		ContentSeedRunner.Totals second = runner.seed(dir, admin);
		assertThat(second.created()).isZero();
		assertThat(second.skipped()).isEqualTo(230);
	}

}
