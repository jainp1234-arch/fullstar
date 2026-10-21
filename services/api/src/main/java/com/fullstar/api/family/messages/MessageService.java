package com.fullstar.api.family.messages;

import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.pagination.Cursor;
import com.fullstar.api.common.pagination.CursorPage;
import com.fullstar.api.common.pagination.PageRequest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * In-app messages of the family (Schema §4.6, §11; App Flow P19; Plan 5.5): newest first, unexpired.
 * RLS keeps them to the family of the request.
 */
@Service
public class MessageService {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JdbcTemplate jdbc;

	public MessageService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Message(UUID id, String kind, String title, String body, JsonNode link, Instant readAt,
			Instant createdAt) {
	}

	public record Page(List<Message> items, String nextCursor, int unread) {
	}

	public Page list(PageRequest page) {
		List<Object> params = new ArrayList<>();
		StringBuilder sql = new StringBuilder("""
				SELECT id, kind, title, body, link::text AS link, read_at, created_at FROM app.messages
				 WHERE expires_at > now()""");
		if (page.cursor() != null) {
			sql.append(" AND (created_at, id) < (CAST(? AS timestamptz), ?)");
			params.add(page.cursor().sortKey());
			params.add(page.cursor().id());
		}
		sql.append(" ORDER BY created_at DESC, id DESC LIMIT ?");
		params.add(page.fetchSize());
		List<Message> rows = jdbc.query(sql.toString(), (rs, n) -> new Message(rs.getObject("id", UUID.class),
				rs.getString("kind"), rs.getString("title"), rs.getString("body"),
				rs.getString("link") == null ? null : JSON.readTree(rs.getString("link")),
				rs.getTimestamp("read_at") == null ? null : rs.getTimestamp("read_at").toInstant(),
				rs.getTimestamp("created_at").toInstant()), params.toArray());
		CursorPage<Message> cursorPage = CursorPage.of(rows, page, m -> new Cursor(m.createdAt().toString(), m.id()));
		Integer unread = jdbc.queryForObject(
				"SELECT count(*) FROM app.messages WHERE read_at IS NULL AND expires_at > now()", Integer.class);
		return new Page(cursorPage.items(), cursorPage.nextCursor(), unread == null ? 0 : unread);
	}

	/** Marking a read message again changes nothing. */
	public Message markRead(UUID id) {
		jdbc.update("UPDATE app.messages SET read_at = COALESCE(read_at, now()) WHERE id = ?", id);
		List<Message> rows = jdbc.query("""
				SELECT id, kind, title, body, link::text AS link, read_at, created_at FROM app.messages WHERE id = ?""",
				(rs, n) -> new Message(rs.getObject("id", UUID.class), rs.getString("kind"), rs.getString("title"),
						rs.getString("body"), rs.getString("link") == null ? null : JSON.readTree(rs.getString("link")),
						rs.getTimestamp("read_at").toInstant(), rs.getTimestamp("created_at").toInstant()),
				id);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		return rows.get(0);
	}

}
