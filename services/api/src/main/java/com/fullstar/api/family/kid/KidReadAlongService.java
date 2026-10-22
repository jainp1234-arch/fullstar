package com.fullstar.api.family.kid;

import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.storage.FileStorage;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * K5 read-along pages (Schema §11 GET /family/kid/chapters/{id}/pages; Plan 6.3): each page's image
 * and narration as signed links (10 minutes), its text and word timings, for one of the child's
 * chapters that is ready to read along. Narration is the 5.4 stand-in until voice-maker (Plan 8.2).
 */
@Service
public class KidReadAlongService {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private final JdbcTemplate jdbc;

	private final FileStorage storage;

	public KidReadAlongService(JdbcTemplate jdbc, FileStorage storage) {
		this.jdbc = jdbc;
		this.storage = storage;
	}

	public record Page(UUID id, int pageNo, String text, String imageUrl, String audioUrl, JsonNode wordTimings) {
	}

	/** resume: the newest unfinished read-along attempt of this chapter, or null. */
	public record Chapter(UUID id, int number, String title, int subjectId, String lang, List<Page> pages,
			KidLessonService.Resume resume) {
	}

	public Chapter pages(UUID childId, UUID familyChapterId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT fc.id, fc.number, fc.title, cb.subject_id, s.code
				  FROM app.child_books cb
				  JOIN app.family_chapters fc ON fc.family_book_id = cb.family_book_id
				  JOIN app.subjects s ON s.id = cb.subject_id
				 WHERE cb.child_id = ? AND fc.id = ?
				   AND fc.status IN ('readalong_ready', 'lessons_being_prepared', 'lessons_ready')""", childId,
				familyChapterId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		List<Page> pages = jdbc.query("""
				SELECT id, page_no, COALESCE(ocr_text, '') AS text, image_key, narration_audio_key,
				       word_timings::text AS word_timings
				  FROM app.pages WHERE family_chapter_id = ? ORDER BY page_no""",
				(rs, n) -> new Page(rs.getObject("id", UUID.class), rs.getInt("page_no"), rs.getString("text"),
						storage.signedGet(rs.getString("image_key")).url().toString(),
						rs.getString("narration_audio_key") == null ? null
								: storage.signedGet(rs.getString("narration_audio_key")).url().toString(),
						rs.getString("word_timings") == null ? JSON.createArrayNode()
								: JSON.readTree(rs.getString("word_timings"))),
				familyChapterId);
		List<KidLessonService.Resume> resume = jdbc.query("""
				SELECT id, resume_state::text AS resume_state FROM app.activity_attempts
				 WHERE child_id = ? AND family_chapter_id = ? AND kind = 'readalong' AND completed_at IS NULL
				 ORDER BY started_at DESC LIMIT 1""",
				(rs, n) -> new KidLessonService.Resume(rs.getObject("id", UUID.class),
						rs.getString("resume_state") == null ? null : JSON.readTree(rs.getString("resume_state"))),
				childId, familyChapterId);
		return new Chapter(familyChapterId, ((Number) row.get("number")).intValue(), (String) row.get("title"),
				((Number) row.get("subject_id")).intValue(), "hindi".equals(row.get("code")) ? "hi" : "en", pages,
				resume.isEmpty() ? null : resume.get(0));
	}

}
