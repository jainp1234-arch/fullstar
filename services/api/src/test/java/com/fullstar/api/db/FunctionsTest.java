package com.fullstar.api.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Date;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class FunctionsTest extends DatabaseTestSupport {

	@Test
	void moveChildToNextClassErasesProgressAndMovesUp() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID staff = newStaff("content_admin");
		UUID topic = newTopic(3, MATHS);
		UUID question = newLibraryItem("question", topic, staff);
		newAttempt(family, child, "lesson", 3);
		UUID book = newFamilyBook(family, 3, MATHS);
		asSystem(c -> {
			exec(c, "INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id) VALUES (?, 3, ?, ?)",
					child, book, family);
			exec(c, "INSERT INTO app.mistakes (child_id, question_item_id, family_id, topic_id, last_wrong_at) VALUES (?, ?, ?, ?, now())",
					child, question, family, topic);
			exec(c, "INSERT INTO app.usage_minutes (child_id, minute_at, family_id) VALUES (?, date_trunc('minute', now()), ?)",
					child, family);
			return newWorksheet(c, family, child, topic);
		});

		Object newClass = asParent(family, c -> value(c, "SELECT app.move_child_to_next_class(?)", child));

		assertThat(newClass).isEqualTo(4);
		assertThat(systemValue("SELECT class_level::int || '/' || stars_total FROM app.children WHERE id = ?", child))
			.isEqualTo("4/0");
		for (String table : List.of("activity_attempts", "mistakes", "usage_minutes", "worksheets", "child_books")) {
			assertThat(systemCount("SELECT count(*) FROM app." + table + " WHERE child_id = ?", child)).as(table).isZero();
		}
	}

	@Test
	void moveChildToNextClassStopsAtClassFiveAndUnknownChild() {
		UUID family = newFamily();
		UUID child = newChild(family, 5);
		assertDbError("MAX_CLASS", () -> asParent(family, c -> value(c, "SELECT app.move_child_to_next_class(?)", child)));
		assertDbError("NOT_FOUND", "P0002",
				() -> asParent(family, c -> value(c, "SELECT app.move_child_to_next_class(?)", UUID.randomUUID())));
	}

	@Test
	void childWeekSummaryCountsTheIndiaWeekAndRanksAreas() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID staff = newStaff("content_admin");
		UUID fractions = newTopic(3, MATHS);
		UUID shapes = newTopic(3, MATHS);
		UUID book = newFamilyBook(family, 3, MATHS);
		UUID ch1 = newFamilyChapter(family, book, 1, "lessons_ready");
		UUID ch2 = newFamilyChapter(family, book, 2, "lessons_ready");
		Date weekStart = asSystem(
				c -> (Date) value(c, "SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::date"));

		asSystem(c -> {
			String at = "((?::date)::timestamp + ?::interval) AT TIME ZONE 'Asia/Kolkata'";
			for (String offset : List.of("10:00", "10:01", "1 day 18:30", "-1 day 10:00", "7 days 10:00")) {
				exec(c, "INSERT INTO app.usage_minutes (child_id, minute_at, family_id) VALUES (?, " + at + ", ?)", child,
						weekStart, offset, family);
			}
			for (UUID chapter : List.of(ch1, ch1, ch2)) {
				exec(c, """
						INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, family_chapter_id,
						                                   started_at, completed_at)
						VALUES (?, ?, ?, 'lesson', 3, ?, now(), """ + at + ")", UUID.randomUUID(), family, child, chapter,
						weekStart, "2 days 09:00");
			}
			for (int i = 0; i < 3; i++) {
				UUID question = newLibraryItem("question", fractions, staff);
				exec(c, "INSERT INTO app.mistakes (child_id, question_item_id, family_id, topic_id, last_wrong_at) VALUES (?, ?, ?, ?, now())",
						child, question, family, fractions);
			}
			UUID worksheet = newWorksheet(c, family, child, shapes);
			exec(c, "INSERT INTO app.worksheet_weak_spots (worksheet_id, topic_id, family_id, child_id) VALUES (?, ?, ?, ?)",
					worksheet, shapes, family, child);
			return null;
		});

		List<Object> summary = asParent(family, c -> rows(c, """
				SELECT minutes, active_days, chapters_done, worksheets_done,
				       jsonb_path_query_array(areas, '$[*].score')::text, areas->0->>'topic_id', areas->0->>'subject'
				  FROM app.child_week_summary(?, ?)""", child, weekStart)).get(0);

		assertThat(summary).containsExactly(3, 2, 2, 1, "[3, 2]", fractions.toString(), "maths");
	}

	@Test
	void completeFamilyDeletionKeepsAnonymousTotalsAndRemovesTheFamily() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID staff = newStaff("super_admin");
		UUID topic = newTopic(3, MATHS);
		UUID lesson = newAttempt(family, child, "lesson", 2);
		asSystem(c -> exec(c, "UPDATE app.activity_attempts SET completed_at = now() WHERE id = ?", lesson));
		asSystem(c -> newWorksheet(c, family, child, topic));
		UUID request = asSystem(c -> (UUID) value(c,
				"INSERT INTO app.deletion_requests (family_id, keycloak_user_id) VALUES (?, 'kc-x') RETURNING id", family));
		long lessonsBefore = total("lessons_watched");
		long worksheetsBefore = total("worksheets_made");

		asSystem(c -> value(c, "SELECT count(*) FROM app.complete_family_deletion(?, ?)", family, staff));

		assertThat(total("lessons_watched") - lessonsBefore).isEqualTo(1);
		assertThat(total("worksheets_made") - worksheetsBefore).isEqualTo(1);
		assertThat(systemCount("SELECT count(*) FROM app.families WHERE id = ?", family)).isZero();
		assertThat(systemCount("SELECT count(*) FROM app.children WHERE id = ?", child)).isZero();
		assertThat(systemValue("SELECT status || ':' || (family_id IS NULL) || ':' || (completed_by = ?) FROM app.deletion_requests WHERE id = ?",
				staff, request)).isEqualTo("done:true:true");
		assertThat(systemCount("SELECT count(*) FROM app.audit_log WHERE action = 'deletion.complete' AND entity_id = ?",
				family.toString())).isEqualTo(1);
	}

	@Test
	void runRetentionReturnsExpiredKeysAndDeletesOldRows() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID staff = newStaff("content_admin");
		UUID topic = newTopic(3, ENGLISH);
		UUID[] passage = newPublishedLibraryItem("passage", topic, staff);
		String tag = UUID.randomUUID().toString();
		String oldRecording = "families/" + family + "/recordings/old-" + tag + ".webm";
		String newRecording = "families/" + family + "/recordings/new-" + tag + ".webm";
		String oldPdf = "families/" + family + "/worksheets/old-" + tag + ".pdf";
		String newPdf = "families/" + family + "/worksheets/new-" + tag + ".pdf";

		asSystem(c -> {
			for (String[] rec : List.of(new String[] { oldRecording, "-1 hour" }, new String[] { newRecording, "6 days" })) {
				UUID attempt = UUID.randomUUID();
				exec(c, "INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, started_at) VALUES (?, ?, ?, 'reading_test', 1, now())",
						attempt, family, child);
				exec(c, """
						INSERT INTO app.reading_tests (id, attempt_id, family_id, child_id, passage_item_id, passage_version_id,
						                               test_date, recording_key, recording_expires_at)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, now() + ?::interval)""", UUID.randomUUID(), attempt, family, child,
						passage[0], passage[1], java.time.LocalDate.now().plusDays(rec[0].equals(oldRecording) ? 0 : 1),
						rec[0], rec[1]);
			}
			for (String[] pdf : List.of(new String[] { oldPdf, "-1 hour" }, new String[] { newPdf, "29 days" })) {
				UUID worksheet = newWorksheet(c, family, child, topic);
				exec(c, "UPDATE app.worksheets SET status = 'ready', pdf_key = ?, pdf_expires_at = now() + ?::interval WHERE id = ?",
						pdf[0], pdf[1], worksheet);
			}
			exec(c, "INSERT INTO app.messages (family_id, kind, title, body, expires_at) VALUES (?, 'system', 'old', ?, now() - interval '1 day')",
					family, tag);
			exec(c, "INSERT INTO app.messages (family_id, kind, title, body) VALUES (?, 'system', 'new', ?)", family, tag);
			exec(c, "INSERT INTO app.audit_log (actor_type, action, entity_type, entity_id, created_at) VALUES ('system', 'test', 'tag', ?, now() - interval '13 months')",
					tag);
			exec(c, "INSERT INTO app.audit_log (actor_type, action, entity_type, entity_id) VALUES ('system', 'test', 'tag', ?)", tag);
			exec(c, "INSERT INTO app.usage_events (event_type, props, occurred_at) VALUES (?, '{}', now() - interval '13 months')", tag);
			exec(c, "INSERT INTO app.usage_events (event_type, props) VALUES (?, '{}')", tag);
			exec(c, "INSERT INTO app.usage_minutes (child_id, minute_at, family_id) VALUES (?, date_trunc('minute', now() - interval '401 days'), ?)",
					child, family);
			exec(c, "INSERT INTO app.usage_minutes (child_id, minute_at, family_id) VALUES (?, date_trunc('minute', now() - interval '399 days'), ?)",
					child, family);
			exec(c, "INSERT INTO app.processed_jobs (idempotency_key, job_type, owner, request, processed_at) VALUES (?, 'http', 'staff', 'POST /x', now() - interval '15 days')",
					"old-" + tag);
			exec(c, "INSERT INTO app.processed_jobs (idempotency_key, job_type, owner, request) VALUES (?, 'http', 'staff', 'POST /x')", "new-" + tag);
			return null;
		});

		List<Object> keys = asSystem(c -> rows(c, "SELECT object_key FROM app.run_retention()")).stream()
			.map(row -> row.get(0))
			.toList();

		assertThat(keys).contains(oldRecording, oldPdf).doesNotContain(newRecording, newPdf);
		assertThat(systemCount("SELECT count(*) FROM app.reading_tests WHERE family_id = ? AND recording_key IS NOT NULL", family))
			.isEqualTo(1);
		assertThat(systemCount("SELECT count(*) FROM app.worksheets WHERE family_id = ? AND pdf_key IS NOT NULL", family))
			.isEqualTo(1);
		assertThat(systemCount("SELECT count(*) FROM app.messages WHERE body = ?", tag)).isEqualTo(1);
		assertThat(systemCount("SELECT count(*) FROM app.audit_log WHERE entity_id = ?", tag)).isEqualTo(1);
		assertThat(systemCount("SELECT count(*) FROM app.usage_events WHERE event_type = ?", tag)).isEqualTo(1);
		assertThat(systemCount("SELECT count(*) FROM app.usage_minutes WHERE child_id = ?", child)).isEqualTo(1);
		assertThat(systemCount("SELECT count(*) FROM app.processed_jobs WHERE idempotency_key LIKE ?", "%-" + tag))
			.isEqualTo(1);
		assertThat(asSystem(c -> rows(c, "SELECT object_key FROM app.run_retention()")).stream()
			.map(row -> row.get(0))
			.toList()).doesNotContain(oldRecording, oldPdf);
	}

	private static UUID newWorksheet(java.sql.Connection c, UUID family, UUID child, UUID topic)
			throws java.sql.SQLException {
		return (UUID) value(c, """
				INSERT INTO app.worksheets (family_id, child_id, subject_id, source, topic_id, question_count, shuffle_seed)
				VALUES (?, ?, 3, 'topic', ?, 5, 42) RETURNING id""", family, child, topic);
	}

	private static long total(String metric) {
		return systemCount("SELECT COALESCE(sum(value), 0) FROM app.anonymous_totals WHERE metric = ?", metric);
	}

}
