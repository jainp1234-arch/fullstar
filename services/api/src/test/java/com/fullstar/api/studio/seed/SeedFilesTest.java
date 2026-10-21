package com.fullstar.api.studio.seed;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.api.studio.content.ContentFormats;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The Class 3 starter content (Plan 4.5) is valid before it reaches a database: every item passes
 * the Schema §5 checks, titles are unique per topic, and the counts match the plan.
 */
class SeedFilesTest {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final Path DIR = Path.of("../../infra/seed/class3");

	@Test
	void everyItemIsValidAndTheCountsMatchThePlan() throws Exception {
		ContentFormats formats = new ContentFormats();
		List<String> problems = new ArrayList<>();
		int topics = 0;
		int lessons = 0;
		int questions = 0;
		int passages = 0;
		Set<String> subjects = new HashSet<>();
		try (Stream<Path> files = Files.list(DIR)) {
			for (Path file : files.filter(f -> f.toString().endsWith(".json")).sorted().toList()) {
				JsonNode root = JSON.readTree(Files.readString(file));
				assertThat(root.path("class_level").asInt()).as(file + " class").isEqualTo(3);
				subjects.add(root.path("subject").asString());
				for (JsonNode topic : root.path("topics")) {
					topics++;
					Set<String> titles = new HashSet<>();
					for (String kind : new String[] { "lessons", "questions", "passages" }) {
						for (JsonNode item : topic.path(kind)) {
							String title = item.path("title").asString();
							String where = file.getFileName() + " / " + topic.path("name").asString() + " / " + title;
							if (title.isBlank() || title.length() > 200 || !titles.add(kind + ":" + title)) {
								problems.add(where + ": title missing, too long or repeated");
							}
							String single = kind.substring(0, kind.length() - 1);
							JsonNode body = item.path("body").deepCopy();
							if ("passage".equals(single)) {
								((ObjectNode) body).put("word_count",
										ContentFormats.wordCount(body.path("text").asString()));
							}
							ContentFormats.Checked checked = formats.check(
									ContentFormats.Kind.valueOf(single.toUpperCase(Locale.ROOT)),
									item.path("question_type").isString() ? item.path("question_type").asString() : null,
									body, item.path("solution").isMissingNode() ? null : item.get("solution"));
							if (!checked.errors().isEmpty()) {
								problems.add(where + ": " + checked.errors());
							}
							switch (single) {
								case "lesson" -> lessons++;
								case "question" -> questions++;
								default -> passages++;
							}
						}
					}
					assertThat(topic.path("lessons").size()).as(topic.path("name").asString() + " lessons").isEqualTo(1);
					assertThat(topic.path("questions").size()).as(topic.path("name").asString() + " questions").isEqualTo(10);
				}
			}
		}
		assertThat(problems).isEmpty();
		assertThat(subjects).containsExactlyInAnyOrder("english", "hindi", "maths", "evs");
		assertThat(topics).isEqualTo(20);
		assertThat(lessons).isEqualTo(20);
		assertThat(questions).isEqualTo(200);
		assertThat(passages).isEqualTo(10);
	}

}
