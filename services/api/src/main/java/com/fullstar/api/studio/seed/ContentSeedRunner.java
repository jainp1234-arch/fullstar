package com.fullstar.api.studio.seed;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.db.DataSourceConfig;
import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.db.RlsSession;
import com.fullstar.api.studio.check.CheckFlags;
import com.fullstar.api.studio.check.ContentCheckService;
import com.fullstar.api.studio.check.PublishService;
import com.fullstar.api.studio.content.ContentFormats;
import com.fullstar.api.studio.content.ContentService;
import com.fullstar.api.studio.content.TopicService;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * make seed-content (profile "seed-content", Plan 4.5): loads starter content from JSON files
 * (infra/seed/class3/*.json) through the same services as the Studio, as the first active super
 * admin: topics, content items (Schema §5 checks), a manual check and publishing. Safe to run
 * again: a topic is found by name and an item by topic, kind and title. Every seeded item gets an
 * audit row content.seed so it can be found for review. The application then exits.
 * <p>
 * File format: {"class_level": 3, "subject": "evs", "topics": [{"name": "...", "lessons": [...],
 * "questions": [...], "passages": [...]}]}; each item is {title, difficulty?, question_type?, body,
 * solution?} as in a Claude draft (Plan 4.3).
 */
@Component
@Profile("seed-content")
public class ContentSeedRunner implements ApplicationRunner {

	private static final Logger log = LoggerFactory.getLogger(ContentSeedRunner.class);

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final Map<String, Boolean> CHECKLIST = ContentCheckService.CHECKLIST.stream()
		.collect(Collectors.toMap(item -> item, item -> Boolean.TRUE));

	private final JdbcTemplate jdbc;

	private final JdbcTemplate system;

	private final TransactionTemplate transactions;

	private final RlsSession rls;

	private final TopicService topics;

	private final ContentService content;

	private final ContentCheckService checks;

	private final PublishService publishing;

	private final AuditLog audit;

	public ContentSeedRunner(JdbcTemplate jdbc, @Qualifier(DataSourceConfig.SYSTEM) JdbcTemplate system,
			TransactionTemplate transactions, RlsSession rls, TopicService topics, ContentService content,
			ContentCheckService checks, PublishService publishing, AuditLog audit) {
		this.jdbc = jdbc;
		this.system = system;
		this.transactions = transactions;
		this.rls = rls;
		this.topics = topics;
		this.content = content;
		this.checks = checks;
		this.publishing = publishing;
		this.audit = audit;
	}

	public record Totals(int created, int skipped) {
	}

	@Override
	public void run(ApplicationArguments args) {
		List<String> dirs = args.getOptionValues("dir");
		if (dirs == null || dirs.size() != 1) {
			throw new IllegalArgumentException("Pass exactly one --dir=<folder with seed JSON files>");
		}
		List<UUID> admins = system.queryForList(
				"SELECT id FROM app.staff_users WHERE role = 'super_admin' AND active ORDER BY created_at LIMIT 1",
				UUID.class);
		if (admins.isEmpty()) {
			throw new IllegalStateException("No active super admin: run make bootstrap-admin first");
		}
		Totals totals = seed(Path.of(dirs.get(0)), admins.get(0));
		log.info("Seed finished created={} skipped={}", totals.created(), totals.skipped());
	}

	public Totals seed(Path dir, UUID staffId) {
		int created = 0;
		int skipped = 0;
		try (Stream<Path> files = Files.list(dir)) {
			for (Path file : files.filter(f -> f.toString().endsWith(".json")).sorted().toList()) {
				JsonNode root = JSON.readTree(Files.readString(file));
				int classLevel = root.path("class_level").asInt();
				String subject = root.path("subject").asString();
				for (JsonNode topic : root.path("topics")) {
					UUID topicId = topic(staffId, classLevel, subject, topic.path("name").asString());
					for (String kind : new String[] { "lessons", "questions", "passages" }) {
						for (JsonNode item : topic.path(kind)) {
							String itemKind = kind.substring(0, kind.length() - 1);
							if (item(staffId, classLevel, subject, topicId, itemKind, item, file.getFileName().toString())) {
								created++;
							}
							else {
								skipped++;
							}
						}
					}
				}
				log.info("Seed file done file={}", file.getFileName());
			}
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		return new Totals(created, skipped);
	}

	private UUID topic(UUID staffId, int classLevel, String subject, String name) {
		return asStaff(() -> {
			List<UUID> found = jdbc.queryForList("""
					SELECT t.id FROM app.topics t JOIN app.subjects s ON s.id = t.subject_id
					 WHERE t.class_level = ? AND s.code = ? AND t.parent_id IS NULL AND t.name = ?""", UUID.class,
					classLevel, subject, name);
			if (!found.isEmpty()) {
				return found.get(0);
			}
			int order = jdbc.queryForObject("""
					SELECT count(*) FROM app.topics t JOIN app.subjects s ON s.id = t.subject_id
					 WHERE t.class_level = ? AND s.code = ? AND t.parent_id IS NULL""", Integer.class, classLevel,
					subject);
			return topics.create(staffId, classLevel, subject, null, name, order).id();
		});
	}

	/** Creates, checks and publishes one item; false if it was already there. */
	private boolean item(UUID staffId, int classLevel, String subject, UUID topicId, String kind, JsonNode item,
			String file) {
		String title = item.path("title").asString().strip();
		return asStaff(() -> {
			Integer known = jdbc.queryForObject("""
					SELECT count(*) FROM app.content_items ci JOIN app.content_versions v ON v.id = ci.current_version_id
					 WHERE ci.topic_id = ? AND ci.kind = ? AND v.title = ?""", Integer.class, topicId, kind, title);
			if (known != null && known > 0) {
				return false;
			}
			JsonNode body = item.path("body");
			if ("passage".equals(kind) && body.isObject()) {
				((ObjectNode) body).put("word_count", ContentFormats.wordCount(body.path("text").asString()));
			}
			JsonNode solution = item.path("solution").isMissingNode() ? null : item.get("solution");
			String lang = "hindi".equals(subject) ? "hi" : "en";
			ContentService.Detail detail = content.create(staffId,
					new ContentService.NewItem(kind, classLevel, subject, topicId,
							"question".equals(kind) ? item.path("question_type").asString() : null,
							item.path("difficulty").asInt(2), lang, title, body, solution));
			UUID itemId = detail.item().id();
			checks.manualCheck(staffId, detail.currentVersion().id(), CHECKLIST, List.<CheckFlags.Flag>of());
			publishing.publish(staffId, itemId);
			audit.staff(staffId, "content.seed", "content_item", itemId,
					Map.of("file", file, "kind", kind.toLowerCase(Locale.ROOT)));
			return true;
		});
	}

	/** One transaction with the RLS session of a super admin, like a Studio request. */
	private <T> T asStaff(Supplier<T> work) {
		return transactions.execute(status -> {
			rls.apply(RequestActor.staff(RequestActor.StaffRole.SUPER_ADMIN));
			return work.get();
		});
	}

}
