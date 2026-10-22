package com.fullstar.api.family.support;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Parent side of reports and support (App Flow P16, P18; Schema §4.6, §11; Plan 7.3). A problem
 * report names published content the family can see (RLS) and keeps the version they saw. A
 * Contact us ticket is a conversation; the team's replies arrive as messages (P19). RLS keeps
 * everything to the family.
 */
@Service
public class SupportService {

	private static final Logger log = LoggerFactory.getLogger(SupportService.class);

	private final JdbcTemplate jdbc;

	public SupportService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Report(UUID id, UUID contentItemId, String reason, String note, String status, Instant createdAt) {
	}

	public record Message(UUID id, String author, String body, Instant createdAt) {
	}

	public record Ticket(UUID id, String subject, String status, Instant createdAt, Instant updatedAt,
			List<Message> messages) {
	}

	/** P18: a lesson or question the family can see; another report of the same open item is fine. */
	public Report report(RequestActor actor, UUID contentItemId, String reason, String note) {
		List<UUID> versions = jdbc.queryForList("""
				SELECT published_version_id FROM app.content_items
				 WHERE id = ? AND status = 'published' AND kind IN ('lesson', 'question')""", UUID.class, contentItemId);
		if (versions.isEmpty()) {
			throw new NotFoundException();
		}
		UUID id = jdbc.queryForObject("""
				INSERT INTO app.problem_reports (family_id, content_item_id, content_version_id, reason, note)
				VALUES (?, ?, ?, ?, ?) RETURNING id""", UUID.class, actor.familyId(), contentItemId, versions.get(0),
				reason, note);
		log.info("Problem reported reportId={} reason={}", id, reason);
		return jdbc.queryForObject("""
				SELECT id, content_item_id, reason, note, status, created_at FROM app.problem_reports WHERE id = ?""",
				(rs, n) -> new Report(rs.getObject("id", UUID.class), rs.getObject("content_item_id", UUID.class),
						rs.getString("reason"), rs.getString("note"), rs.getString("status"),
						rs.getTimestamp("created_at").toInstant()),
				id);
	}

	public List<Ticket> tickets() {
		return jdbc.query("SELECT id FROM app.support_tickets ORDER BY updated_at DESC, id LIMIT 50",
				(rs, n) -> ticket(rs.getObject("id", UUID.class)));
	}

	/** P16 Contact us: a new ticket with the parent's first message. */
	public Ticket open(RequestActor actor, String subject, String body) {
		UUID id = jdbc.queryForObject(
				"INSERT INTO app.support_tickets (family_id, subject) VALUES (?, ?) RETURNING id", UUID.class,
				actor.familyId(), subject);
		jdbc.update("INSERT INTO app.support_messages (ticket_id, family_id, author, body) VALUES (?, ?, 'parent', ?)",
				id, actor.familyId(), body);
		log.info("Support ticket opened ticketId={}", id);
		return ticket(id);
	}

	/** A parent reply opens the ticket again for the team. */
	public Ticket reply(RequestActor actor, UUID ticketId, String body) {
		ticket(ticketId);
		jdbc.update("INSERT INTO app.support_messages (ticket_id, family_id, author, body) VALUES (?, ?, 'parent', ?)",
				ticketId, actor.familyId(), body);
		jdbc.update("UPDATE app.support_tickets SET status = 'open', updated_at = now() WHERE id = ?", ticketId);
		return ticket(ticketId);
	}

	Ticket ticket(UUID id) {
		List<Map<String, Object>> rows = jdbc.queryForList(
				"SELECT id, subject, status, created_at, updated_at FROM app.support_tickets WHERE id = ?", id);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> t = rows.get(0);
		List<Message> messages = jdbc.query("""
				SELECT id, author, body, created_at FROM app.support_messages WHERE ticket_id = ? ORDER BY created_at, id""",
				(rs, n) -> new Message(rs.getObject("id", UUID.class), rs.getString("author"), rs.getString("body"),
						rs.getTimestamp("created_at").toInstant()),
				id);
		return new Ticket(id, (String) t.get("subject"), (String) t.get("status"),
				((java.sql.Timestamp) t.get("created_at")).toInstant(),
				((java.sql.Timestamp) t.get("updated_at")).toInstant(), messages);
	}

}
