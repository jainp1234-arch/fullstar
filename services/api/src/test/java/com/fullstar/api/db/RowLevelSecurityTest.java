package com.fullstar.api.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class RowLevelSecurityTest extends DatabaseTestSupport {

	private static final List<String> FAMILY_ONLY = List.of("children", "child_books", "activity_attempts",
			"answer_events", "mistakes", "usage_minutes", "reading_tests", "worksheets", "worksheet_weak_spots",
			"lesson_previews");

	private static final List<String> FAMILY_AND_STAFF_READ = List.of("family_books", "family_chapters", "uploads",
			"upload_files", "pages", "problem_reports", "support_tickets", "support_messages");

	private static Family familyA;

	private static Family familyB;

	private static UUID staff;

	@BeforeAll
	static void createTwoFamiliesWithEveryKindOfRow() {
		staff = newStaff("content_admin");
		familyA = Family.create(staff);
		familyB = Family.create(staff);
	}

	@Test
	void familyACannotReadFamilyBRowsInAnyFamilyTable() {
		for (String table : concat(FAMILY_ONLY, FAMILY_AND_STAFF_READ, List.of("worksheet_questions", "messages"))) {
			long all = systemCount("SELECT count(*) FROM app." + table);
			long seenByA = asParent(familyA.id, c -> count(c, "SELECT count(*) FROM app." + table));
			long ownOfA = systemCount(ownRowsSql(table), familyA.id);
			assertThat(seenByA).as(table).isEqualTo(ownOfA).isPositive().isLessThan(all);
			long bSeenByA = asParent(familyA.id, c -> count(c, ownRowsSql(table), familyB.id));
			assertThat(bSeenByA).as(table + " rows of family B").isZero();
		}
		Long families = asParent(familyA.id, c -> count(c, "SELECT count(*) FROM app.families"));
		assertThat(families).isEqualTo(1);
	}

	@Test
	void familyACannotWriteFamilyBRows() {
		assertRlsDenied(() -> asParent(familyA.id, c -> exec(c, """
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Sneaky', 7, 2, 'fox')""", familyB.id)));
		Integer updated = asParent(familyA.id,
				c -> exec(c, "UPDATE app.children SET first_name = 'Changed' WHERE id = ?", familyB.child));
		Integer deleted = asParent(familyA.id, c -> exec(c, "DELETE FROM app.activity_attempts WHERE family_id = ?", familyB.id));
		assertThat(updated).isZero();
		assertThat(deleted).isZero();
		assertRlsDenied(() -> asParent(familyA.id,
				c -> exec(c, "UPDATE app.children SET family_id = ? WHERE id = ?", familyB.id, familyA.child)));
	}

	@Test
	void staffCannotReadAnyFamilyOnlyTable() {
		for (String table : concat(FAMILY_ONLY, List.of("worksheet_questions", "families"))) {
			Long seen = asStaff("super_admin", c -> count(c, "SELECT count(*) FROM app." + table));
			assertThat(seen).as(table).isZero();
		}
		Long attempts = asStaff("content_admin", c -> count(c, "SELECT count(*) FROM app.activity_attempts"));
		Long readingTests = asStaff("content_admin", c -> count(c, "SELECT count(*) FROM app.reading_tests"));
		assertThat(attempts).isZero();
		assertThat(readingTests).isZero();
	}

	@Test
	void staffReadFamilyBooksAndUpdateOnlyTheAllowedTables() {
		for (String table : FAMILY_AND_STAFF_READ) {
			Long seen = asStaff("content_admin", c -> count(c, "SELECT count(*) FROM app." + table));
			assertThat(seen).as(table).isEqualTo(systemCount("SELECT count(*) FROM app." + table));
		}
		Integer chapters = asStaff("content_admin",
				c -> exec(c, "UPDATE app.family_chapters SET title = 'Renamed' WHERE id = ?", familyA.chapter));
		Integer uploads = asStaff("content_admin",
				c -> exec(c, "UPDATE app.uploads SET status = 'failed' WHERE family_id = ?", familyA.id));
		assertThat(chapters).isEqualTo(1);
		assertThat(uploads).isZero();
	}

	@Test
	void requestsWithoutSessionValuesSeeNoFamilyData() {
		Long children = inTransaction("app_api", API_PASSWORD, null, null, null,
				c -> count(c, "SELECT count(*) FROM app.children"));
		Long subjects = inTransaction("app_api", API_PASSWORD, null, null, null,
				c -> count(c, "SELECT count(*) FROM app.subjects"));
		assertThat(children).isZero();
		assertThat(subjects).isEqualTo(5);
	}

	@Test
	void parentsReadOnlyPublishedContentTheyAreEntitledTo() {
		UUID topic = newTopic(3, MATHS);
		UUID[] published = newPublishedLibraryItem("lesson", topic, staff);
		UUID draft = newLibraryItem("lesson", topic, staff);
		UUID draftVersion = newVersion(draft, staff);
		UUID laterVersion = newVersion(published[0], staff);

		List<Object> visible = asParent(familyA.id,
				c -> rows(c, "SELECT id FROM app.content_items WHERE topic_id = ?", topic)).stream().map(r -> r.get(0)).toList();
		assertThat(visible).containsExactly(published[0]);
		List<Object> versions = asParent(familyA.id,
				c -> rows(c, "SELECT id FROM app.content_versions WHERE item_id IN (?, ?)", published[0], draft)).stream()
			.map(r -> r.get(0))
			.toList();
		assertThat(versions).containsExactly(published[1]).doesNotContain(draftVersion, laterVersion);

		Long chapterItemsA = asParent(familyA.id, c -> count(c,
				"SELECT count(*) FROM app.content_items WHERE catalog_chapter_id = ?", familyA.catalogChapter));
		Long chapterItemsB = asParent(familyB.id, c -> count(c,
				"SELECT count(*) FROM app.content_items WHERE catalog_chapter_id = ?", familyA.catalogChapter));
		assertThat(chapterItemsA).isEqualTo(1);
		assertThat(chapterItemsB).isZero();
	}

	@Test
	void contentChecksAndPrepTasksAreStaffOnly() {
		for (String table : List.of("content_checks", "content_check_flags", "prep_tasks")) {
			Long parent = asParent(familyA.id, c -> count(c, "SELECT count(*) FROM app." + table));
			Long staffSeen = asStaff("content_admin", c -> count(c, "SELECT count(*) FROM app." + table));
			assertThat(parent).as(table).isZero();
			assertThat(staffSeen).as(table).isEqualTo(systemCount("SELECT count(*) FROM app." + table));
		}
		assertRlsDenied(() -> asParent(familyA.id, c -> exec(c,
				"INSERT INTO app.topics (class_level, subject_id, name) VALUES (3, 3, 'Parent topic')")));
	}

	@Test
	void supportMessagesCannotBeForgedByParents() {
		assertRlsDenied(() -> asParent(familyA.id, c -> exec(c, """
				INSERT INTO app.support_messages (ticket_id, family_id, author, staff_id, body)
				VALUES (?, ?, 'staff', ?, 'Fake reply')""", familyA.ticket, familyA.id, staff)));
		Integer parent = asParent(familyA.id, c -> exec(c, """
				INSERT INTO app.support_messages (ticket_id, family_id, author, body) VALUES (?, ?, 'parent', 'Hello')""",
				familyA.ticket, familyA.id));
		Integer reply = asStaff("content_admin", c -> exec(c, """
				INSERT INTO app.support_messages (ticket_id, family_id, author, staff_id, body)
				VALUES (?, ?, 'staff', ?, 'Reply')""", familyA.ticket, familyA.id, staff));
		Integer staffMessage = asStaff("content_admin", c -> exec(c, """
				INSERT INTO app.messages (family_id, kind, title, body) VALUES (?, 'support_reply', 'Reply', 'See inbox')""",
				familyA.id));
		assertThat(parent + reply + staffMessage).isEqualTo(3);
	}

	@Test
	void auditLogIsWrittenByAnyActorAndReadBySuperAdminsOnly() {
		String tag = UUID.randomUUID().toString();
		String insert = "INSERT INTO app.audit_log (actor_type, actor_id, action, entity_type, entity_id) VALUES (?, 'x', 'test', 'tag', ?)";
		asParent(familyA.id, c -> exec(c, insert, "parent", tag));
		asStaff("content_admin", c -> exec(c, insert, "staff", tag));
		assertRlsDenied(() -> inTransaction("app_api", API_PASSWORD, null, null, null, c -> exec(c, insert, "system", tag)));
		assertRlsDenied(() -> asParent(familyA.id, c -> exec(c, insert, "staff", tag)));
		assertRlsDenied(() -> asStaff("content_admin", c -> exec(c, insert, "parent", tag)));

		String read = "SELECT count(*) FROM app.audit_log WHERE entity_id = ?";
		Long parent = asParent(familyA.id, c -> count(c, read, tag));
		Long contentAdmin = asStaff("content_admin", c -> count(c, read, tag));
		Long superAdmin = asStaff("super_admin", c -> count(c, read, tag));
		assertThat(parent).isZero();
		assertThat(contentAdmin).isZero();
		assertThat(superAdmin).isEqualTo(2);
	}

	@Test
	void staffUsersReadableByStaffAndWrittenBySuperAdmins() {
		Long contentAdmin = asStaff("content_admin", c -> count(c, "SELECT count(*) FROM app.staff_users WHERE id = ?", staff));
		Long parent = asParent(familyA.id, c -> count(c, "SELECT count(*) FROM app.staff_users"));
		assertThat(contentAdmin).isEqualTo(1);
		assertThat(parent).isZero();
		String insert = "INSERT INTO app.staff_users (keycloak_user_id, display_name, role) VALUES (?, 'New', 'content_admin')";
		assertRlsDenied(() -> asStaff("content_admin", c -> exec(c, insert, "kc-" + UUID.randomUUID())));
		Integer created = asStaff("super_admin", c -> exec(c, insert, "kc-" + UUID.randomUUID()));
		assertThat(created).isEqualTo(1);
	}

	@Test
	void deletionRequestsInsertedByTheirFamilyAndManagedBySuperAdmins() {
		String insert = "INSERT INTO app.deletion_requests (family_id, keycloak_user_id) VALUES (?, 'kc')";
		asParent(familyA.id, c -> exec(c, insert, familyA.id));
		assertRlsDenied(() -> asParent(familyA.id, c -> exec(c, insert, familyB.id)));
		Long parent = asParent(familyA.id, c -> count(c, "SELECT count(*) FROM app.deletion_requests"));
		Long superAdmin = asStaff("super_admin",
				c -> count(c, "SELECT count(*) FROM app.deletion_requests WHERE family_id = ?", familyA.id));
		assertThat(parent).isZero();
		assertThat(superAdmin).isEqualTo(1);
	}

	@Test
	void operationsTablesFollowTheApprovedAccess() {
		// V12: http idempotency records are visible only to their owner
		String key = "idem-" + UUID.randomUUID();
		String insertJob = "INSERT INTO app.processed_jobs (idempotency_key, job_type, owner, request) VALUES (?, 'http', ?, 'POST /x')";
		asParent(familyA.id, c -> exec(c, insertJob, key, familyA.id.toString()));
		String readJob = "SELECT count(*) FROM app.processed_jobs WHERE idempotency_key = ?";
		Long ownJobs = asParent(familyA.id, c -> count(c, readJob, key));
		Long otherJobs = asParent(familyB.id, c -> count(c, readJob, key));
		assertThat(ownJobs).isEqualTo(1);
		assertThat(otherJobs).isZero();
		assertRlsDenied(() -> asParent(familyB.id, c -> exec(c, insertJob, "idem-" + UUID.randomUUID(), familyA.id.toString())));
		assertRlsDenied(() -> asParent(familyA.id, c -> exec(c,
				"INSERT INTO app.processed_jobs (idempotency_key, job_type, owner, request) VALUES (?, 'job', ?, 'x')",
				"job-" + UUID.randomUUID(), familyA.id.toString())));

		String event = "event-" + UUID.randomUUID();
		asParent(familyA.id, c -> exec(c, "INSERT INTO app.usage_events (event_type, props) VALUES (?, '{}')", event));
		String readEvents = "SELECT count(*) FROM app.usage_events WHERE event_type = ?";
		Long contentAdmin = asStaff("content_admin", c -> count(c, readEvents, event));
		Long superAdmin = asStaff("super_admin", c -> count(c, readEvents, event));
		assertThat(contentAdmin).isZero();
		assertThat(superAdmin).isEqualTo(1);

		asSystem(c -> exec(c, """
				INSERT INTO app.anonymous_totals (metric, period_month, value) VALUES ('rls_test', date_trunc('month', now())::date, 1)
				ON CONFLICT DO NOTHING"""));
		Long parentTotals = asParent(familyA.id, c -> count(c, "SELECT count(*) FROM app.anonymous_totals"));
		Long superTotals = asStaff("super_admin", c -> count(c, "SELECT count(*) FROM app.anonymous_totals WHERE metric = 'rls_test'"));
		assertThat(parentTotals).isZero();
		assertThat(superTotals).isEqualTo(1);
		assertRlsDenied(() -> asStaff("super_admin", c -> exec(c,
				"INSERT INTO app.anonymous_totals (metric, period_month, value) VALUES ('x', '2026-01-01', 1)")));
	}

	@Test
	void parentsReadAndMarkTheirMessagesButCannotCreateThem() {
		assertRlsDenied(() -> asParent(familyA.id, c -> exec(c,
				"INSERT INTO app.messages (family_id, kind, title, body) VALUES (?, 'system', 'Fake', 'Fake')", familyA.id)));
		Integer marked = asParent(familyA.id,
				c -> exec(c, "UPDATE app.messages SET read_at = now() WHERE family_id = ?", familyA.id));
		assertThat(marked).isPositive();
		assertRlsDenied(() -> asParent(familyA.id,
				c -> exec(c, "UPDATE app.messages SET family_id = ? WHERE family_id = ?", familyB.id, familyA.id)));
	}

	// ---- helpers ----

	private static String ownRowsSql(String table) {
		return "worksheet_questions".equals(table)
				? "SELECT count(*) FROM app.worksheet_questions q JOIN app.worksheets w ON w.id = q.worksheet_id WHERE w.family_id = ?"
				: "SELECT count(*) FROM app." + table + " WHERE family_id = ?";
	}

	@SafeVarargs
	private static List<String> concat(List<String>... lists) {
		return java.util.Arrays.stream(lists).flatMap(List::stream).toList();
	}

	private static void assertRlsDenied(Runnable work) {
		assertDbError("row-level security", "42501", work);
	}

	/** A family with at least one row in every family-owned table. */
	private record Family(UUID id, UUID child, UUID chapter, UUID ticket, UUID catalogChapter) {

		static Family create(UUID staff) {
			UUID family = newFamily();
			UUID child = newChild(family, 3);
			UUID topic = newTopic(3, MATHS);
			UUID[] question = newPublishedLibraryItem("question", topic, staff);
			UUID[] passage = newPublishedLibraryItem("passage", newTopic(3, ENGLISH), staff);
			UUID book = newFamilyBook(family, 3, MATHS);
			UUID chapter = newFamilyChapter(family, book, 1, "readalong_ready");
			return asSystem(c -> {
				UUID catalogBook = (UUID) value(c, "INSERT INTO app.catalog_books (class_level, subject_id, title) VALUES (3, 3, 'Book') RETURNING id");
				UUID catalogChapter = (UUID) value(c, "INSERT INTO app.catalog_chapters (catalog_book_id, number, title) VALUES (?, 1, 'Ch') RETURNING id", catalogBook);
				exec(c, "UPDATE app.family_chapters SET catalog_chapter_id = ? WHERE id = ?", catalogChapter, chapter);
				UUID chapterItem = (UUID) value(c, """
						INSERT INTO app.content_items (kind, scope, class_level, subject_id, catalog_chapter_id, lang, created_by)
						VALUES ('lesson', 'catalog_chapter', 3, 3, ?, 'en', ?) RETURNING id""", catalogChapter, staff);
				UUID chapterVersion = (UUID) value(c, "INSERT INTO app.content_versions (item_id, title, body, created_by) VALUES (?, 'L', '{}', ?) RETURNING id",
						chapterItem, staff);
				exec(c, "INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual')", chapterVersion);
				exec(c, "UPDATE app.content_items SET status = 'published', current_version_id = ?, published_version_id = ? WHERE id = ?",
						chapterVersion, chapterVersion, chapterItem);
				UUID check = (UUID) value(c, "INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual') RETURNING id", chapterVersion);
				exec(c, "INSERT INTO app.content_check_flags (check_id, severity, category, location, reason, resolution) VALUES (?, 'warning', 'other', '{}', 'r', 'fixed')", check);
				exec(c, "INSERT INTO app.prep_tasks (family_chapter_id, catalog_chapter_id) VALUES (?, ?)", chapter, catalogChapter);

				exec(c, "INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id) VALUES (?, 3, ?, ?)", child, book, family);
				UUID upload = (UUID) value(c, "INSERT INTO app.uploads (family_id, family_book_id, source, file_count) VALUES (?, ?, 'pdf', 1) RETURNING id",
						family, book);
				UUID file = (UUID) value(c, "INSERT INTO app.upload_files (upload_id, family_id, object_key, content_type, byte_size) VALUES (?, ?, ?, 'application/pdf', 100) RETURNING id",
						upload, family, "families/" + family + "/uploads/" + upload + "/f");
				exec(c, "INSERT INTO app.pages (family_chapter_id, family_id, upload_file_id, page_no, image_key) VALUES (?, ?, ?, 1, 'k')",
						chapter, family, file);
				exec(c, "INSERT INTO app.lesson_previews (family_id, content_item_id, result) VALUES (?, ?, 'looks_good')", family, chapterItem);

				UUID attempt = UUID.randomUUID();
				exec(c, "INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, started_at) VALUES (?, ?, ?, 'practice', 3, now())",
						attempt, family, child);
				exec(c, """
						INSERT INTO app.answer_events (id, attempt_id, family_id, child_id, question_item_id, question_version_id, topic_id, is_correct, answer, answered_at)
						VALUES (?, ?, ?, ?, ?, ?, ?, false, '{}', now())""", UUID.randomUUID(), attempt, family, child, question[0], question[1], topic);
				exec(c, "INSERT INTO app.usage_minutes (child_id, minute_at, family_id) VALUES (?, date_trunc('minute', now()), ?)", child, family);
				UUID readingAttempt = UUID.randomUUID();
				exec(c, "INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, started_at) VALUES (?, ?, ?, 'reading_test', 1, now())",
						readingAttempt, family, child);
				exec(c, """
						INSERT INTO app.reading_tests (id, attempt_id, family_id, child_id, passage_item_id, passage_version_id, test_date)
						VALUES (?, ?, ?, ?, ?, ?, current_date)""", UUID.randomUUID(), readingAttempt, family, child, passage[0], passage[1]);
				UUID worksheet = (UUID) value(c, """
						INSERT INTO app.worksheets (family_id, child_id, subject_id, source, topic_id, question_count, shuffle_seed)
						VALUES (?, ?, 3, 'topic', ?, 5, 1) RETURNING id""", family, child, topic);
				exec(c, "INSERT INTO app.worksheet_questions (worksheet_id, position, question_item_id, question_version_id) VALUES (?, 1, ?, ?)",
						worksheet, question[0], question[1]);
				exec(c, "INSERT INTO app.worksheet_weak_spots (worksheet_id, topic_id, family_id, child_id) VALUES (?, ?, ?, ?)",
						worksheet, topic, family, child);

				exec(c, "INSERT INTO app.problem_reports (family_id, content_item_id, content_version_id, reason) VALUES (?, ?, ?, 'spelling')",
						family, question[0], question[1]);
				UUID ticket = (UUID) value(c, "INSERT INTO app.support_tickets (family_id, subject) VALUES (?, 'Help') RETURNING id", family);
				exec(c, "INSERT INTO app.support_messages (ticket_id, family_id, author, body) VALUES (?, ?, 'parent', 'Hi')", ticket, family);
				exec(c, "INSERT INTO app.messages (family_id, kind, title, body) VALUES (?, 'system', 'Welcome', 'Hello')", family);
				return new Family(family, child, chapter, ticket, catalogChapter);
			});
		}

	}

}
