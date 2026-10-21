package com.fullstar.api.family.parent;

import com.fullstar.api.common.db.RequestActor;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** "Request data deletion (once)" (Schema §11). Parents can insert but not read deletion_requests. */
@Service
public class DeletionRequestService {

	private static final Logger log = LoggerFactory.getLogger(DeletionRequestService.class);

	/** Same as the deletion_requests.due_by default. */
	static final Duration DUE_AFTER = Duration.ofDays(30);

	private final JdbcTemplate jdbc;

	public DeletionRequestService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Result(Instant requestedAt, Instant dueBy, boolean created) {
	}

	public Result request(RequestActor actor, String keycloakUserId) {
		// Only one concurrent call can set the timestamp; the others see it already set
		List<Instant> won = jdbc.query("""
				UPDATE app.families SET deletion_requested_at = now()
				 WHERE id = ? AND deletion_requested_at IS NULL
				RETURNING deletion_requested_at""", (rs, n) -> rs.getTimestamp(1).toInstant(), actor.familyId());
		if (!won.isEmpty()) {
			jdbc.update("INSERT INTO app.deletion_requests (family_id, keycloak_user_id) VALUES (?, ?)",
					actor.familyId(), keycloakUserId);
			log.info("Deletion requested familyId={}", actor.familyId());
			return new Result(won.get(0), won.get(0).plus(DUE_AFTER), true);
		}
		Instant requestedAt = jdbc.queryForObject("SELECT deletion_requested_at FROM app.families WHERE id = ?",
				(rs, n) -> rs.getTimestamp(1).toInstant(), actor.familyId());
		return new Result(requestedAt, requestedAt.plus(DUE_AFTER), false);
	}

}
