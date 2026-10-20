package com.fullstar.api.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TriggersTest extends DatabaseTestSupport {

	@Test
	void setUpdatedAtRefreshesTheTimestamp() {
		UUID family = newFamily();
		asSystem(c -> exec(c, "UPDATE app.families SET updated_at = '2020-01-01' WHERE id = ?", family));
		Instant updated = asSystem(c -> ((Timestamp) value(c, "SELECT updated_at FROM app.families WHERE id = ?",
				family)).toInstant());
		assertThat(updated).isAfter(Instant.now().minusSeconds(60));
	}

	@Test
	void enforceMaxChildrenBlocksAThirdChild() {
		UUID family = newFamily();
		newChild(family, 3);
		newChild(family, 2);
		assertDbError("MAX_CHILDREN", () -> asParent(family, c -> exec(c, """
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Third', 6, 1, 'fox')""", family)));
		assertThat(systemCount("SELECT count(*) FROM app.children WHERE family_id = ?", family)).isEqualTo(2);
	}

	@Test
	void checkChildBookAcceptsMatchingBookAndRejectsMismatch() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID classThreeMaths = newFamilyBook(family, 3, MATHS);
		UUID classTwoMaths = newFamilyBook(family, 2, MATHS);
		UUID otherFamilyBook = newFamilyBook(newFamily(), 3, MATHS);

		asParent(family, c -> exec(c, "INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id) VALUES (?, 3, ?, ?)",
				child, classThreeMaths, family));

		assertDbError("BOOK_MISMATCH", () -> asSystem(c -> exec(c,
				"UPDATE app.child_books SET family_book_id = ? WHERE child_id = ?", classTwoMaths, child)));
		assertDbError("BOOK_MISMATCH", () -> asSystem(c -> exec(c,
				"UPDATE app.child_books SET subject_id = 1 WHERE child_id = ?", child)));
		assertDbError("BOOK_MISMATCH", () -> asSystem(c -> exec(c,
				"UPDATE app.child_books SET family_book_id = ? WHERE child_id = ?", otherFamilyBook, child)));
	}

	@Test
	void trackMistakesOpensCountsResolvesAndReopens() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID staff = newStaff("content_admin");
		UUID topic = newTopic(3, MATHS);
		UUID[] question = newPublishedLibraryItem("question", topic, staff);
		UUID attempt = newAttempt(family, child, "practice", 0);

		answer(family, child, attempt, question, topic, false);
		answer(family, child, attempt, question, topic, false);
		assertThat(mistake(child, question[0])).containsExactly(2, 0, false);

		answer(family, child, attempt, question, topic, true);
		assertThat(mistake(child, question[0])).containsExactly(2, 1, false);
		answer(family, child, attempt, question, topic, true);
		assertThat(mistake(child, question[0])).containsExactly(2, 2, true);

		answer(family, child, attempt, question, topic, false);
		assertThat(mistake(child, question[0])).containsExactly(3, 0, false);
	}

	@Test
	void trackMistakesIgnoresCorrectAnswersWithoutAMistake() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID staff = newStaff("content_admin");
		UUID topic = newTopic(3, MATHS);
		UUID[] question = newPublishedLibraryItem("question", topic, staff);
		UUID attempt = newAttempt(family, child, "practice", 0);

		answer(family, child, attempt, question, topic, true);
		assertThat(systemCount("SELECT count(*) FROM app.mistakes WHERE child_id = ?", child)).isZero();
	}

	@Test
	void addStarsKeepsTheChildTotalInStep() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID first = newAttempt(family, child, "lesson", 2);
		newAttempt(family, child, "practice", 3);
		assertThat(stars(child)).isEqualTo(5);

		asParent(family, c -> exec(c, "UPDATE app.activity_attempts SET stars = 1 WHERE id = ?", first));
		assertThat(stars(child)).isEqualTo(4);
	}

	@Test
	void limitReadingTestsAllowsTwoPerIndiaDay() {
		UUID family = newFamily();
		UUID child = newChild(family, 3);
		UUID staff = newStaff("content_admin");
		UUID[] passage = newPublishedLibraryItem("passage", newTopic(3, ENGLISH), staff);
		LocalDate today = LocalDate.of(2026, 10, 20);

		readingTest(family, child, passage, today);
		readingTest(family, child, passage, today);
		assertDbError("READING_LIMIT", () -> readingTest(family, child, passage, today));
		readingTest(family, child, passage, today.plusDays(1));
	}

	@Test
	void versionsAreNumberedPerItemAndImmutable() {
		UUID staff = newStaff("content_admin");
		UUID topic = newTopic(3, MATHS);
		UUID item = newLibraryItem("lesson", topic, staff);
		UUID other = newLibraryItem("lesson", topic, staff);
		UUID v1 = newVersion(item, staff);
		UUID v2 = newVersion(item, staff);
		UUID otherV1 = newVersion(other, staff);

		assertThat(versionNo(v1)).isEqualTo(1);
		assertThat(versionNo(v2)).isEqualTo(2);
		assertThat(versionNo(otherV1)).isEqualTo(1);
		assertDbError("VERSION_IMMUTABLE",
				() -> asStaff("content_admin", c -> exec(c, "UPDATE app.content_versions SET title = 'x' WHERE id = ?", v1)));
	}

	@Test
	void guardPublishRequiresTheLatestCheckPassedWithNoOpenFlags() {
		UUID staff = newStaff("content_admin");
		UUID item = newLibraryItem("lesson", newTopic(3, MATHS), staff);
		UUID version = newVersion(item, staff);

		assertDbError("CHECK_NOT_PASSED", () -> publish(item, version));

		UUID failed = check(version, "failed");
		assertDbError("CHECK_NOT_PASSED", () -> publish(item, version));

		UUID passed = check(version, "passed");
		UUID flag = asSystem(c -> (UUID) value(c, """
				INSERT INTO app.content_check_flags (check_id, severity, category, location, reason)
				VALUES (?, 'warning', 'language', '{"path":"title"}', 'Long word') RETURNING id""", passed));
		assertDbError("CHECK_NOT_PASSED", () -> publish(item, version));

		asSystem(c -> exec(c, "UPDATE app.content_check_flags SET resolution = 'fixed' WHERE id = ?", flag));
		publish(item, version);
		assertThat(failed).isNotNull();
		assertThat(systemValue("SELECT published_version_id FROM app.content_items WHERE id = ?", item))
			.isEqualTo(version);
	}

	@Test
	void rollUpBookStatusWorstChapterWins() {
		UUID family = newFamily();
		UUID book = newFamilyBook(family, 3, MATHS);
		UUID ch1 = newFamilyChapter(family, book, 1, "processing");
		UUID ch2 = newFamilyChapter(family, book, 2, "readalong_ready");
		assertThat(bookStatus(book)).isEqualTo("getting_ready");

		chapterStatus(ch1, "needs_attention");
		assertThat(bookStatus(book)).isEqualTo("needs_attention");
		chapterStatus(ch1, "readalong_ready");
		assertThat(bookStatus(book)).isEqualTo("readalong_ready");
		chapterStatus(ch2, "lessons_being_prepared");
		assertThat(bookStatus(book)).isEqualTo("lessons_being_prepared");
		chapterStatus(ch1, "lessons_ready");
		chapterStatus(ch2, "lessons_ready");
		assertThat(bookStatus(book)).isEqualTo("lessons_ready");
		chapterStatus(ch2, "suggested");
		assertThat(bookStatus(book)).isEqualTo("getting_ready");
	}

	@Test
	void catalogChapterReadyUpdatesFamiliesThroughStaffRls() {
		UUID family = newFamily();
		UUID book = newFamilyBook(family, 3, MATHS);
		UUID familyChapter = newFamilyChapter(family, book, 4, "readalong_ready");
		UUID catalogChapter = asSystem(c -> {
			UUID catalogBook = (UUID) value(c, "INSERT INTO app.catalog_books (class_level, subject_id, title) VALUES (3, 3, 'Maths 3') RETURNING id");
			return (UUID) value(c, "INSERT INTO app.catalog_chapters (catalog_book_id, number, title) VALUES (?, 4, 'Shapes') RETURNING id",
					catalogBook);
		});
		asSystem(c -> exec(c, "UPDATE app.family_chapters SET catalog_chapter_id = ? WHERE id = ?", catalogChapter,
				familyChapter));
		UUID task = asSystem(c -> (UUID) value(c,
				"INSERT INTO app.prep_tasks (family_chapter_id, catalog_chapter_id) VALUES (?, ?) RETURNING id",
				familyChapter, catalogChapter));

		asStaff("content_admin", c -> exec(c, "UPDATE app.catalog_chapters SET status = 'ready' WHERE id = ?", catalogChapter));

		assertThat(systemValue("SELECT status FROM app.family_chapters WHERE id = ?", familyChapter))
			.isEqualTo("lessons_ready");
		assertThat(bookStatus(book)).isEqualTo("lessons_ready");
		assertThat(systemValue("SELECT status FROM app.prep_tasks WHERE id = ?", task)).isEqualTo("done");
		assertThat(systemValue("SELECT ready_at IS NOT NULL FROM app.catalog_chapters WHERE id = ?",
				catalogChapter)).isEqualTo(true);
		List<List<Object>> messages = asSystem(c -> rows(c,
				"SELECT kind, body, link->>'screen', link->>'family_chapter_id' FROM app.messages WHERE family_id = ?", family));
		assertThat(messages).containsExactly(List.of("lessons_ready",
				"Lessons for Maths Ch 4 are ready. We recommend a quick preview.", "P8a", familyChapter.toString()));
	}

	// ---- helpers ----

	private static void answer(UUID family, UUID child, UUID attempt, UUID[] question, UUID topic, boolean correct) {
		asParent(family, c -> exec(c, """
				INSERT INTO app.answer_events (id, attempt_id, family_id, child_id, question_item_id, question_version_id,
				                               topic_id, is_correct, answer, answered_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}'::jsonb, now())""", UUID.randomUUID(), attempt, family, child,
				question[0], question[1], topic, correct));
	}

	private static List<Object> mistake(UUID child, UUID question) {
		return asSystem(c -> rows(c, """
				SELECT wrong_count, correct_streak::int, resolved_at IS NOT NULL FROM app.mistakes
				 WHERE child_id = ? AND question_item_id = ?""", child, question)).get(0);
	}

	private static int stars(UUID child) {
		Integer result = asSystem(c -> (Integer) value(c, "SELECT stars_total FROM app.children WHERE id = ?", child));
		return result;
	}

	private static void readingTest(UUID family, UUID child, UUID[] passage, LocalDate date) {
		UUID attempt = newAttempt(family, child, "reading_test", 0);
		asParent(family, c -> exec(c, """
				INSERT INTO app.reading_tests (id, attempt_id, family_id, child_id, passage_item_id, passage_version_id, test_date)
				VALUES (?, ?, ?, ?, ?, ?, ?)""", UUID.randomUUID(), attempt, family, child, passage[0], passage[1], date));
	}

	private static int versionNo(UUID version) {
		Integer result = asSystem(c -> (Integer) value(c, "SELECT version_no FROM app.content_versions WHERE id = ?", version));
		return result;
	}

	private static UUID check(UUID version, String status) {
		return asSystem(c -> (UUID) value(c,
				"INSERT INTO app.content_checks (version_id, status, model) VALUES (?, ?, 'manual') RETURNING id", version,
				status));
	}

	private static void publish(UUID item, UUID version) {
		asStaff("content_admin", c -> exec(c, """
				UPDATE app.content_items SET current_version_id = ?, published_version_id = ?, status = 'published'
				 WHERE id = ?""", version, version, item));
	}

	private static String bookStatus(UUID book) {
		return asSystem(c -> (String) value(c, "SELECT status FROM app.family_books WHERE id = ?", book));
	}

	private static void chapterStatus(UUID chapter, String status) {
		asSystem(c -> exec(c, "UPDATE app.family_chapters SET status = ? WHERE id = ?", status, chapter));
	}

}
