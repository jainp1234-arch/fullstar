package com.fullstar.api.common.db;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Sets the Schema §7 session values with SET LOCAL semantics (set_config(..., true)), so they end
 * with the transaction and never leak to the next user of a pooled connection.
 */
@Component
public class RlsSession {

	private final JdbcTemplate jdbc;

	public RlsSession(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public void apply(RequestActor actor) {
		if (!TransactionSynchronizationManager.isActualTransactionActive()) {
			throw new IllegalStateException("RLS session values must be set inside a transaction");
		}
		String familyId = actor.familyId() == null ? "" : actor.familyId().toString();
		String staffRole = actor.staffRole() == null ? "" : actor.staffRole().dbValue();
		jdbc.queryForList("SELECT set_config('app.actor', ?, true), set_config('app.family_id', ?, true), "
				+ "set_config('app.staff_role', ?, true)", actor.actorValue(), familyId, staffRole);
	}

}
