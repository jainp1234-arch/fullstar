package com.fullstar.api.studio.check;

import com.fullstar.api.common.claude.ClaudeClient;
import com.fullstar.api.common.db.DataSourceConfig;
import com.fullstar.api.studio.ai.DraftPrompts;
import com.fullstar.api.studio.ai.DraftService;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

/**
 * The content-check agent (Schema §12 content-check, App Flow S11; Plan 4.4): sends one version to
 * Claude with the checklist and writes the structured flags. Runs as app_system from the job
 * consumer; the Claude call happens outside any transaction, the results are written in one.
 */
@Component
public class ContentCheckAgent {

	private static final Logger log = LoggerFactory.getLogger(ContentCheckAgent.class);

	private final JdbcTemplate system;

	private final TransactionTemplate systemTransactions;

	private final DraftPrompts prompts;

	private final ClaudeClient claude;

	public ContentCheckAgent(@Qualifier(DataSourceConfig.SYSTEM) JdbcTemplate system,
			@Qualifier(DataSourceConfig.SYSTEM) TransactionTemplate systemTransactions, DraftPrompts prompts,
			ClaudeClient claude) {
		this.system = system;
		this.systemTransactions = systemTransactions;
		this.prompts = prompts;
		this.claude = claude;
	}

	public enum Outcome {

		CHECKED, ALREADY_DONE

	}

	/** Checks the version of a running check. A failure throws, so the job is retried (then DLQ). */
	public Outcome run(UUID checkId, String jobKey) {
		List<Map<String, Object>> rows = system.queryForList("""
				SELECT c.status, v.title, v.body::text AS body, v.solution::text AS solution, ci.kind, ci.question_type,
				       ci.class_level, ci.lang, s.name AS subject, t.name AS topic
				  FROM app.content_checks c
				  JOIN app.content_versions v ON v.id = c.version_id
				  JOIN app.content_items ci ON ci.id = v.item_id
				  JOIN app.subjects s ON s.id = ci.subject_id
				  LEFT JOIN app.topics t ON t.id = ci.topic_id
				 WHERE c.id = ?""", checkId);
		if (rows.isEmpty() || !"running".equals(rows.get(0).get("status"))) {
			return Outcome.ALREADY_DONE;
		}
		Map<String, Object> row = rows.get(0);
		String content = "{\"body\": " + row.get("body")
				+ (row.get("solution") == null ? "" : ", \"solution\": " + row.get("solution")) + "}";
		Map<String, String> values = new LinkedHashMap<>();
		values.put("kind_name", row.get("question_type") == null ? (String) row.get("kind")
				: row.get("question_type") + " question");
		values.put("class_level", String.valueOf(row.get("class_level")));
		values.put("subject", (String) row.get("subject"));
		values.put("topic", row.get("topic") == null ? "(chapter content)" : (String) row.get("topic"));
		values.put("lang_name", "hi".equals(row.get("lang")) ? "Hindi" : "English");
		values.put("title", (String) row.get("title"));
		values.put("content", content);
		DraftPrompts.Prompt prompt = prompts.contentCheck(values);

		String reply = claude.complete(prompt.system(), prompt.user());
		JsonNode json = DraftService.readJson(reply);
		Map<String, String> errors = new LinkedHashMap<>();
		List<CheckFlags.Flag> flags = json == null ? List.of()
				: CheckFlags.read(json.isArray() ? json : json.path("flags"), "flags", errors);
		if (json == null || !errors.isEmpty() || !(json.isArray() || json.path("flags").isArray())) {
			throw new IllegalStateException("Content-check reply is not in the flag format");
		}
		long critical = flags.stream().filter(CheckFlags.Flag::critical).count();
		Outcome outcome = systemTransactions.execute(status -> {
			int claimed = system.update("""
					INSERT INTO app.processed_jobs (idempotency_key, job_type) VALUES (?, ?)
					ON CONFLICT (idempotency_key) DO NOTHING""", "job:" + jobKey, ContentCheckService.JOB_TYPE);
			int updated = claimed == 0 ? 0 : system.update("""
					UPDATE app.content_checks
					   SET status = ?, critical_count = ?, warning_count = ?, finished_at = now()
					 WHERE id = ? AND status = 'running'""", critical > 0 ? "failed" : "passed", critical,
					flags.size() - critical, checkId);
			if (updated == 0) {
				status.setRollbackOnly();
				return Outcome.ALREADY_DONE;
			}
			ContentCheckService.insertFlags(system, checkId, flags);
			return Outcome.CHECKED;
		});
		log.info("Content check done checkId={} outcome={} flags={} critical={}", checkId, outcome, flags.size(),
				critical);
		return outcome;
	}

	/** After the last try: the check ends in error so the admin can run it again or check by hand. */
	public void giveUp(UUID checkId, String reason) {
		system.update("""
				UPDATE app.content_checks SET status = 'error', error_message = ?, finished_at = now()
				 WHERE id = ? AND status = 'running'""", reason, checkId);
		log.warn("Content check gave up checkId={}", checkId);
	}

}
