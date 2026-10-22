package com.fullstar.api.family.worksheets;

import com.fullstar.api.common.db.DataSourceConfig;
import com.fullstar.api.common.pdf.GotenbergClient;
import com.fullstar.api.common.storage.FileStorage;
import com.fullstar.api.common.storage.StorageKeys;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/**
 * Renders one worksheet to an A4 PDF (Schema §12 worksheet-render, worker "API → Gotenberg"; Plan
 * 7.2), as app_system: the stored questions (so a reprint is the same), the answer key, Noto Sans
 * Devanagari bundled for Hindi. The PDF is kept 30 days (pdf_expires_at) at worksheets/&lt;id&gt;.pdf.
 */
@Service
public class WorksheetRenderer {

	private static final Logger log = LoggerFactory.getLogger(WorksheetRenderer.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JdbcTemplate system;

	private final GotenbergClient gotenberg;

	private final FileStorage storage;

	private final byte[] font;

	public WorksheetRenderer(@Qualifier(DataSourceConfig.SYSTEM) JdbcTemplate system, GotenbergClient gotenberg,
			FileStorage storage) {
		this.system = system;
		this.gotenberg = gotenberg;
		this.storage = storage;
		try (InputStream in = new ClassPathResource("worksheet/" + WorksheetHtml.FONT_FILE).getInputStream()) {
			this.font = in.readAllBytes();
		}
		catch (IOException ex) {
			throw new UncheckedIOException("Missing worksheet font", ex);
		}
	}

	/** The HTML for a worksheet (also used by tests); null if it is gone. */
	String html(UUID worksheetId) {
		List<Map<String, Object>> rows = system.queryForList("""
				SELECT w.family_id, s.code, s.name, c.class_level, fc.number, COALESCE(fc.title, t.name) AS title
				  FROM app.worksheets w
				  JOIN app.subjects s ON s.id = w.subject_id
				  JOIN app.children c ON c.id = w.child_id
				  LEFT JOIN app.family_chapters fc ON fc.id = w.family_chapter_id
				  LEFT JOIN app.topics t ON t.id = w.topic_id
				 WHERE w.id = ?""", worksheetId);
		if (rows.isEmpty()) {
			return null;
		}
		Map<String, Object> w = rows.get(0);
		String heading = "Class " + w.get("class_level") + " " + w.get("name") + " · "
				+ (w.get("number") == null ? w.get("title") : "Chapter " + w.get("number") + ": " + w.get("title"));
		List<WorksheetHtml.Question> questions = system.query("""
				SELECT q.position, ci.question_type, cv.body::text AS body, cv.solution::text AS solution
				  FROM app.worksheet_questions q
				  JOIN app.content_items ci ON ci.id = q.question_item_id
				  JOIN app.content_versions cv ON cv.id = q.question_version_id
				 WHERE q.worksheet_id = ? ORDER BY q.position""",
				(rs, n) -> new WorksheetHtml.Question(rs.getInt("position"), rs.getString("question_type"),
						JSON.readTree(rs.getString("body")),
						rs.getString("solution") == null ? null : JSON.readTree(rs.getString("solution"))),
				worksheetId);
		return WorksheetHtml.render(heading, "hindi".equals(w.get("code")) ? "hi" : "en", questions);
	}

	/** Renders and stores the PDF; answers false when the worksheet was deleted meanwhile. */
	public boolean render(UUID worksheetId) {
		String html = html(worksheetId);
		if (html == null) {
			return false;
		}
		UUID familyId = system.queryForObject("SELECT family_id FROM app.worksheets WHERE id = ?", UUID.class,
				worksheetId);
		byte[] pdf = gotenberg.htmlToPdf(
				Map.of("index.html", html.getBytes(StandardCharsets.UTF_8), WorksheetHtml.FONT_FILE, font));
		String key = StorageKeys.worksheet(familyId, worksheetId);
		storage.put(key, pdf, "application/pdf");
		system.update("""
				UPDATE app.worksheets SET status = 'ready', pdf_key = ?, pdf_expires_at = now() + interval '30 days'
				 WHERE id = ?""", key, worksheetId);
		log.info("Worksheet rendered worksheetId={} bytes={}", worksheetId, pdf.length);
		return true;
	}

	public void failed(UUID worksheetId) {
		system.update("UPDATE app.worksheets SET status = 'failed' WHERE id = ?", worksheetId);
	}

}
