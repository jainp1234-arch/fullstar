package com.fullstar.api.studio.support;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
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
 * Studio problem reports (S7) and support inbox (S12) (Schema §11; Plan 7.3). Fixed sends the
 * family a report_fixed message; a reply sends a support_reply message (P19). Staff see a short
 * family reference, never who the family is.
 */
@Service
public class StudioSupportService {

	private static final Logger log = LoggerFactory.getLogger(StudioSupportService.class);

	/** Schema §4.6 messages.body varchar(500); a long reply is cut in the message (the ticket has it whole). */
	private static final int MESSAGE_BODY_MAX = 500;

	private final JdbcTemplate jdbc;

	private final AuditLog audit;

	public StudioSupportService(JdbcTemplate jdbc, AuditLog audit) {
		this.jdbc = jdbc;
		this.audit = audit;
	}

	public record Report(UUID id, String status, String reason, String note, Instant createdAt, UUID contentItemId,
			String kind, String title, int versionNo, String familyRef, Instant handledAt) {
	}

	public record TicketSummary(UUID id, String subject, String status, String familyRef, Instant updatedAt,
			String lastMessage, String lastAuthor) {
	}

	public record Message(UUID id, String author, String body, Instant createdAt) {
	}

	public record Ticket(TicketSummary ticket, List<Message> messages) {
	}

	public List<Report> reports(String status) {
		return jdbc.query("""
				SELECT r.id, r.status, r.reason, r.note, r.created_at, r.content_item_id, ci.kind, cv.title, cv.version_no,
				       left(r.family_id::text, 8) AS family_ref, r.handled_at
				  FROM app.problem_reports r
				  JOIN app.content_items ci ON ci.id = r.content_item_id
				  JOIN app.content_versions cv ON cv.id = r.content_version_id
				 WHERE r.status = ? ORDER BY r.created_at, r.id LIMIT 200""",
				(rs, n) -> new Report(rs.getObject("id", UUID.class), rs.getString("status"), rs.getString("reason"),
						rs.getString("note"), rs.getTimestamp("created_at").toInstant(),
						rs.getObject("content_item_id", UUID.class), rs.getString("kind"), rs.getString("title"),
						rs.getInt("version_no"), rs.getString("family_ref"),
						rs.getTimestamp("handled_at") == null ? null : rs.getTimestamp("handled_at").toInstant()),
				status);
	}

	/** S7: fixed (tells the family) or dismissed; only an open report. */
	public Report handle(UUID staffId, UUID reportId, String status) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT r.family_id, r.status, ci.kind FROM app.problem_reports r
				  JOIN app.content_items ci ON ci.id = r.content_item_id WHERE r.id = ?""", reportId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		if (!"open".equals(rows.get(0).get("status"))) {
			throw new ApiException(ErrorCode.CONFLICT, "This report was handled already");
		}
		jdbc.update("UPDATE app.problem_reports SET status = ?, handled_by = ?, handled_at = now() WHERE id = ?", status,
				staffId, reportId);
		if ("fixed".equals(status)) {
			String what = "question".equals(rows.get(0).get("kind")) ? "question" : "lesson";
			jdbc.update("""
					INSERT INTO app.messages (family_id, kind, title, body) VALUES (?, 'report_fixed', 'Problem fixed', ?)""",
					rows.get(0).get("family_id"), "The " + what + " you reported has been fixed. Thank you for telling us.");
		}
		audit.staff(staffId, "report." + status, "problem_report", reportId, Map.of());
		log.info("Problem report handled reportId={} status={}", reportId, status);
		return reports(status).stream().filter(r -> r.id().equals(reportId)).findFirst().orElseThrow();
	}

	public List<TicketSummary> tickets(List<String> statuses) {
		return jdbc.query("""
				SELECT t.id, t.subject, t.status, left(t.family_id::text, 8) AS family_ref, t.updated_at, m.body, m.author
				  FROM app.support_tickets t
				  LEFT JOIN LATERAL (SELECT body, author FROM app.support_messages
				                      WHERE ticket_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) m ON true
				 WHERE t.status = ANY (?) ORDER BY t.updated_at DESC, t.id LIMIT 200""",
				(rs, n) -> summary(rs), (Object) statuses.toArray(String[]::new));
	}

	public Ticket ticket(UUID id) {
		List<TicketSummary> rows = jdbc.query("""
				SELECT t.id, t.subject, t.status, left(t.family_id::text, 8) AS family_ref, t.updated_at, m.body, m.author
				  FROM app.support_tickets t
				  LEFT JOIN LATERAL (SELECT body, author FROM app.support_messages
				                      WHERE ticket_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) m ON true
				 WHERE t.id = ?""", (rs, n) -> summary(rs), id);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		List<Message> messages = jdbc.query("""
				SELECT id, author, body, created_at FROM app.support_messages WHERE ticket_id = ? ORDER BY created_at, id""",
				(rs, n) -> new Message(rs.getObject("id", UUID.class), rs.getString("author"), rs.getString("body"),
						rs.getTimestamp("created_at").toInstant()),
				id);
		return new Ticket(rows.get(0), messages);
	}

	/** S12: the reply goes into the ticket and, as a message, to the family (P19 → P16). */
	public Ticket reply(UUID staffId, UUID ticketId, String body) {
		UUID familyId = jdbc.queryForList("SELECT family_id FROM app.support_tickets WHERE id = ?", UUID.class, ticketId)
			.stream()
			.findFirst()
			.orElseThrow(NotFoundException::new);
		jdbc.update("""
				INSERT INTO app.support_messages (ticket_id, family_id, author, staff_id, body)
				VALUES (?, ?, 'staff', ?, ?)""", ticketId, familyId, staffId, body);
		jdbc.update("UPDATE app.support_tickets SET status = 'answered', updated_at = now() WHERE id = ?", ticketId);
		String shown = body.length() > MESSAGE_BODY_MAX ? body.substring(0, MESSAGE_BODY_MAX - 1) + "…" : body;
		jdbc.update("""
				INSERT INTO app.messages (family_id, kind, title, body, link)
				VALUES (?, 'support_reply', 'Reply from our team', ?, jsonb_build_object('screen', 'P16', 'ticket_id', CAST(? AS text)))""",
				familyId, shown, ticketId.toString());
		audit.staff(staffId, "support.reply", "support_ticket", ticketId, Map.of());
		return ticket(ticketId);
	}

	private static TicketSummary summary(java.sql.ResultSet rs) throws java.sql.SQLException {
		return new TicketSummary(rs.getObject("id", UUID.class), rs.getString("subject"), rs.getString("status"),
				rs.getString("family_ref"), rs.getTimestamp("updated_at").toInstant(), rs.getString("body"),
				rs.getString("author"));
	}

}
