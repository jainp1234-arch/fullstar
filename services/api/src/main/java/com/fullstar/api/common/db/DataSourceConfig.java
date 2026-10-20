package com.fullstar.api.common.db;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.persistence.EntityManagerFactory;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Two pools (Schema §7): app_api for every user request (RLS enforced) and app_system for the
 * job-results consumer, retention and deletion (BYPASSRLS). JPA uses the primary app_api pool.
 */
@Configuration(proxyBeanMethods = false)
public class DataSourceConfig {

	public static final String SYSTEM = "system";

	@Bean
	@Primary
	@ConfigurationProperties("fullstar.datasource.api")
	DataSource dataSource() {
		return DataSourceBuilder.create().type(HikariDataSource.class).build();
	}

	// Declared explicitly: the system beans below would otherwise switch off Boot's defaults.
	@Bean
	@Primary
	JdbcTemplate jdbcTemplate(DataSource dataSource) {
		return new JdbcTemplate(dataSource);
	}

	@Bean
	@Primary
	PlatformTransactionManager transactionManager(EntityManagerFactory entityManagerFactory) {
		return new JpaTransactionManager(entityManagerFactory);
	}

	@Bean
	@Primary
	TransactionTemplate transactionTemplate(PlatformTransactionManager transactionManager) {
		return new TransactionTemplate(transactionManager);
	}

	@Bean
	@Qualifier(SYSTEM)
	@ConfigurationProperties("fullstar.datasource.system")
	DataSource systemDataSource() {
		return DataSourceBuilder.create().type(HikariDataSource.class).build();
	}

	@Bean
	@Qualifier(SYSTEM)
	JdbcTemplate systemJdbcTemplate(@Qualifier(SYSTEM) DataSource systemDataSource) {
		return new JdbcTemplate(systemDataSource);
	}

	@Bean
	@Qualifier(SYSTEM)
	PlatformTransactionManager systemTransactionManager(@Qualifier(SYSTEM) DataSource systemDataSource) {
		return new DataSourceTransactionManager(systemDataSource);
	}

	@Bean
	@Qualifier(SYSTEM)
	TransactionTemplate systemTransactionTemplate(@Qualifier(SYSTEM) PlatformTransactionManager systemTransactionManager) {
		return new TransactionTemplate(systemTransactionManager);
	}

	@Bean
	@ConditionalOnMissingBean
	ActorResolver anonymousActorResolver() {
		return request -> RequestActor.ANONYMOUS;
	}

}
