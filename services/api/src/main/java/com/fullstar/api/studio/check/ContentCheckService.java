package com.fullstar.api.studio.check;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.claude.AiProperties;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.jobs.JobPublisher;
import com.fullstar.api.common.jobs.JobQueue;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/**
 * Content checks (Schema §4.2, §11, §12, §12a; S11; Plan 4.4). A check belongs to one version. The
 * agent check (FEATURE_AI_CHECK) runs as the content-check job; the manual check (trial) records the
 * admin's checklist and flags at once. Publishing needs the latest check passed with no open flag
 * (version_check_passed); warnings are closed by accepting them with a note.
 */
@Service
public class ContentCheckService {

	private static final Logger log = LoggerFactory.getLogger(ContentCheckService.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	public static final String JOB_TYPE = "content-check";

	/** Schema §12a manual-check checklist; every item must be true for the check to pass. */
	public static final List<String> CHECKLIST = List.of("age_suitability", "facts_match", "answers_correct",
			"language", "difficulty", "no_bias", "no_personal_info");

	static final int NOTE_MAX = 500;

	private final JdbcTemplate jdbc;

	private final JobPublisher jobs;

	private final AiProperties ai;

	private final AuditLog audit;

	public ContentCheckService(JdbcTemplate jdbc, JobPublisher jobs, AiProperties ai, AuditLog audit) {
		this.jdbc = jdbc;
		this.jobs = jobs;
		this.ai = ai;
		this.audit = audit;
	}

	public record FlagView(UUID id, String severity, String category, String location, String reason,
			String resolution, String resolutionNote, Instant resolvedAt) {
	}

	public record Check(UUID id, UUID versionId, UUID itemId, int versionNo, String status, String model,
			int criticalCount, int warningCount, int openFlags, boolean publishable, String errorMessage,
			Instant startedAt, Instant finishedAt, List<FlagView> flags) {
	}

	/** Runs the content-check agent (async): 202 with the running check. */
	public Check requestAgentCheck(UUID staffId, UUID versionId) {
		if (!ai.checkEnabled()) {
			throw new ApiException(ErrorCode.FEATURE_DISABLED,
					"The content-check agent is switched off; use the manual check");
		}
		UUID itemId = currentVersionOf(versionId);
		UUID checkId = jdbc.queryForObject(
				"INSERT INTO app.content_checks (version_id, model) VALUES (?, ?) RETURNING id", UUID.class, versionId,
				ai.model());
		markInCheck(itemId);
		jobs.publish(JobQueue.CONTENT_CHECK, JOB_TYPE, checkId.toString(), Map.of("content_check_id", checkId));
		audit.staff(staffId, "content.check", "content_version", versionId, Map.of("model", ai.model()));
		log.info("Content check requested checkId={} versionId={}", checkId, versionId);
		return get(checkId);
	}

	/** Trial manual check (Schema §12a): passed only if every checklist item is true and no flag is critical. */
	public Check manualCheck(UUID staffId, UUID versionId, Map<String, Boolean> checklist, List<CheckFlags.Flag> flags) {
		UUID itemId = currentVersionOf(versionId);
		boolean allTrue = CHECKLIST.stream().allMatch(item -> Boolean.TRUE.equals(checklist.get(item)));
		long critical = flags.stream().filter(CheckFlags.Flag::critical).count();
		long warnings = flags.size() - critical;
		boolean passed = allTrue && critical == 0;
		UUID checkId = jdbc.queryForObject("""
				INSERT INTO app.content_checks (version_id, status, model, critical_count, warning_count, finished_at)
				VALUES (?, ?, 'manual', ?, ?, now()) RETURNING id""", UUID.class, versionId,
				passed ? "passed" : "failed", critical, warnings);
		insertFlags(jdbc, checkId, flags);
		markInCheck(itemId);
		Map<String, Object> metadata = new LinkedHashMap<>();
		metadata.put("model", "manual");
		metadata.put("passed", passed);
		metadata.put("critical", critical);
		metadata.put("warnings", warnings);
		audit.staff(staffId, "content.check", "content_version", versionId, metadata);
		log.info("Manual check checkId={} versionId={} passed={}", checkId, versionId, passed);
		return get(checkId);
	}

	public Check get(UUID checkId) {
		List<Check> rows = jdbc.query("""
				SELECT c.id, c.version_id, v.item_id, v.version_no, c.status, c.model, c.critical_count, c.warning_count,
				       c.error_message, c.started_at, c.finished_at, app.version_check_passed(c.version_id) AS publishable,
				       (SELECT count(*) FROM app.content_check_flags f WHERE f.check_id = c.id AND f.resolution = 'open')
				         AS open_flags
				  FROM app.content_checks c JOIN app.content_versions v ON v.id = c.version_id
				 WHERE c.id = ?""", (rs, n) -> check(rs, flags(rs.getObject("id", UUID.class))), checkId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		return rows.get(0);
	}

	/** The latest check of a version, or null if it has none. */
	public Check latestFor(UUID versionId) {
		List<UUID> ids = jdbc.queryForList(
				"SELECT id FROM app.content_checks WHERE version_id = ? ORDER BY started_at DESC, id LIMIT 1", UUID.class,
				versionId);
		return ids.isEmpty() ? null : get(ids.get(0));
	}

	/** Accept a warning with a note (Schema §11). Critical flags are fixed by a new version instead. */
	public Check accept(UUID staffId, UUID flagId, String note) {
		List<Map<String, Object>> rows = jdbc.queryForList(
				"SELECT check_id, severity, resolution FROM app.content_check_flags WHERE id = ? FOR UPDATE", flagId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> flag = rows.get(0);
		if (!"warning".equals(flag.get("severity"))) {
			throw new ApiException(ErrorCode.CONFLICT,
					"Critical flags can't be accepted; fix the content and check the new version");
		}
		UUID checkId = (UUID) flag.get("check_id");
		if ("open".equals(flag.get("resolution"))) {
			jdbc.update("""
					UPDATE app.content_check_flags
					   SET resolution = 'accepted', resolution_note = ?, resolved_by = ?, resolved_at = now()
					 WHERE id = ?""", note, staffId, flagId);
			audit.staff(staffId, "content.flag_accept", "content_check_flag", flagId, Map.of("check_id", checkId));
			log.info("Flag accepted flagId={} checkId={}", flagId, checkId);
		}
		return get(checkId);
	}

	/** Writes flags; the location is stored as {"path": "..."} (Schema §4.2). */
	static void insertFlags(JdbcTemplate jdbc, UUID checkId, List<CheckFlags.Flag> flags) {
		for (CheckFlags.Flag flag : flags) {
			jdbc.update("""
					INSERT INTO app.content_check_flags (check_id, severity, category, location, reason)
					VALUES (?, ?, ?, CAST(? AS jsonb), ?)""", checkId, flag.severity(), flag.category(),
					JSON.writeValueAsString(Map.of("path", flag.location())), flag.reason());
		}
	}

	/** Only the current version of an item that is not archived can be checked. */
	private UUID currentVersionOf(UUID versionId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT ci.id, ci.status, ci.current_version_id = v.id AS is_current
				  FROM app.content_versions v JOIN app.content_items ci ON ci.id = v.item_id
				 WHERE v.id = ?""", versionId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		Map<String, Object> row = rows.get(0);
		if (!Boolean.TRUE.equals(row.get("is_current")) || "archived".equals(row.get("status"))) {
			throw new ApiException(ErrorCode.CONFLICT, "Only the current version of live content can be checked");
		}
		return (UUID) row.get("id");
	}

	private void markInCheck(UUID itemId) {
		jdbc.update("UPDATE app.content_items SET status = 'in_check' WHERE id = ? AND status = 'draft'", itemId);
	}

	private List<FlagView> flags(UUID checkId) {
		return jdbc.query("""
				SELECT id, severity, category, location->>'path' AS path, reason, resolution, resolution_note, resolved_at
				  FROM app.content_check_flags WHERE check_id = ?
				 ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, id""",
				(rs, n) -> new FlagView(rs.getObject("id", UUID.class), rs.getString("severity"),
						rs.getString("category"), rs.getString("path"), rs.getString("reason"),
						rs.getString("resolution"), rs.getString("resolution_note"),
						rs.getTimestamp("resolved_at") == null ? null : rs.getTimestamp("resolved_at").toInstant()),
				checkId);
	}

	private static Check check(ResultSet rs, List<FlagView> flags) throws SQLException {
		return new Check(rs.getObject("id", UUID.class), rs.getObject("version_id", UUID.class),
				rs.getObject("item_id", UUID.class), rs.getInt("version_no"), rs.getString("status"),
				rs.getString("model"), rs.getInt("critical_count"), rs.getInt("warning_count"), rs.getInt("open_flags"),
				rs.getBoolean("publishable"), rs.getString("error_message"), rs.getTimestamp("started_at").toInstant(),
				rs.getTimestamp("finished_at") == null ? null : rs.getTimestamp("finished_at").toInstant(), flags);
	}

}
