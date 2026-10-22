package com.fullstar.api.family.worksheets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestAws;
import com.fullstar.api.testsupport.TestTokens;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Plan 7.2: worksheets from a topic's question bank, rendered by a real Gotenberg (Tech Stack §7):
 * a Hindi PDF embeds Noto Sans Devanagari; a reprint has the same questions; shuffle again only
 * before the first print; weak-spot ticks feed Areas to work on.
 */
class WorksheetTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final HttpClient HTTP = HttpClient.newHttpClient();

	static final GenericContainer<?> GOTENBERG = new GenericContainer<>("gotenberg/gotenberg:8.37.0")
		.withExposedPorts(3000)
		.waitingFor(Wait.forHttp("/health").forPort(3000).withStartupTimeout(Duration.ofMinutes(3)));

	static {
		GOTENBERG.start();
	}

	@DynamicPropertySource
	static void gotenberg(DynamicPropertyRegistry registry) {
		registry.add("fullstar.gotenberg.url",
				() -> "http://" + GOTENBERG.getHost() + ":" + GOTENBERG.getMappedPort(3000));
	}

	@Autowired
	private WorksheetRenderer renderer;

	private String bearer;

	private String grant;

	private UUID familyId;

	private UUID childId;

	private UUID staffId;

	@BeforeEach
	void family() throws Exception {
		String subject = UUID.randomUUID().toString();
		bearer = TestTokens.token().subject(subject).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		MvcResult pin = mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andExpect(status().isCreated()).andReturn();
		grant = JSON.readTree(pin.getResponse().getContentAsString()).path("data").path("parent_grant").asString();
		familyId = systemQuery("SELECT id FROM app.families WHERE keycloak_user_id = ?", subject);
		childId = systemQuery("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, 'Asha', 8, 3, 'cat') RETURNING id""", familyId);
		staffId = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Teacher', 'content_admin') RETURNING id""", UUID.randomUUID().toString());
	}

	private ResultActions parent(MockHttpServletRequestBuilder request, String json) throws Exception {
		request.header(HttpHeaders.AUTHORIZATION, bearer).header("X-Parent-Grant", grant);
		if (json != null) {
			request.contentType(MediaType.APPLICATION_JSON).content(json);
		}
		return mvc.perform(request);
	}

	private static JsonNode data(MvcResult result) throws Exception {
		return JSON.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");
	}

	/** A topic of the subject with this many published multiple-choice questions. */
	private UUID topic(int subjectId, String name, List<String> prompts) {
		UUID topicId = systemQuery("INSERT INTO app.topics (class_level, subject_id, name) VALUES (3, ?, ?) RETURNING id",
				subjectId, name + " " + UUID.randomUUID());
		for (String prompt : prompts) {
			UUID itemId = systemQuery("""
					INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang, created_by)
					VALUES ('question', 'library', 3, ?, ?, 'mcq', ?, ?) RETURNING id""", subjectId, topicId,
					subjectId == 2 ? "hi" : "en", staffId);
			String body = JSON.writeValueAsString(java.util.Map.of("prompt", prompt, "options",
					List.of(java.util.Map.of("id", "a", "text", subjectId == 2 ? "विद्यालय" : "Yes"),
							java.util.Map.of("id", "b", "text", subjectId == 2 ? "क्षत्रिय" : "No"))));
			UUID versionId = systemQuery("""
					INSERT INTO app.content_versions (item_id, version_no, title, body, solution, created_by)
					VALUES (?, 1, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?) RETURNING id""", itemId, prompt, body,
					"{\"correct\": [\"a\"], \"explanation\": \"" + (subjectId == 2 ? "श्री ने बताया।" : "Because.") + "\"}",
					staffId);
			systemQuery("INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual') RETURNING id",
					versionId);
			systemQuery("""
					UPDATE app.content_items SET current_version_id = ?, published_version_id = ?, status = 'published',
					       published_at = now() WHERE id = ? RETURNING id""", versionId, versionId, itemId);
		}
		return topicId;
	}

	private JsonNode create(int subjectId, UUID topicId, int count) throws Exception {
		return data(parent(post("/api/v1/family/parent/worksheets"), """
				{ "child_id": "%s", "subject_id": %d, "source": "topic", "topic_id": "%s", "question_count": %d }"""
			.formatted(childId, subjectId, topicId, count)).andExpect(status().isCreated()).andReturn());
	}

	/** Asks for the PDF until it is ready; answers its signed link. */
	private String pdfUrl(String worksheetId) throws Exception {
		Instant until = Instant.now().plus(Duration.ofSeconds(60));
		while (Instant.now().isBefore(until)) {
			MvcResult result = parent(get("/api/v1/family/parent/worksheets/" + worksheetId + "/pdf"), null).andReturn();
			if (result.getResponse().getStatus() == 200) {
				return data(result).path("url").asString();
			}
			assertThat(result.getResponse().getStatus()).isEqualTo(202);
			Thread.sleep(500);
		}
		throw new AssertionError("PDF not ready");
	}

	private static byte[] download(String url) throws Exception {
		HttpResponse<byte[]> response = HTTP.send(HttpRequest.newBuilder(URI.create(url)).build(),
				HttpResponse.BodyHandlers.ofByteArray());
		assertThat(response.statusCode()).isEqualTo(200);
		return response.body();
	}

	private static List<String> order(JsonNode detail) {
		List<String> ids = new ArrayList<>();
		detail.path("questions").forEach(q -> ids.add(q.path("id").asString()));
		return ids;
	}

	@Test
	void aHindiWorksheetPdfEmbedsNotoSansDevanagariAndAReprintHasTheSameQuestions() throws Exception {
		UUID topic = topic(2, "संज्ञा", List.of("सही शब्द चुनिए: क्षत्रिय", "विद्यालय में कौन पढ़ता है?",
				"श्रीमान का अर्थ क्या है?", "द्वार कहाँ है?", "स्त्री शब्द पहचानिए", "ज्ञान किसे कहते हैं?"));
		JsonNode created = create(2, topic, 5);
		String id = created.path("worksheet").path("id").asString();
		assertThat(created.path("questions")).hasSize(5);
		assertThat(created.path("questions").get(0).path("solution").isMissingNode()
				|| created.path("questions").get(0).path("solution").isNull()).isTrue();

		byte[] pdf = download(pdfUrl(id));
		assertThat(new String(pdf, 0, 5, StandardCharsets.ISO_8859_1)).isEqualTo("%PDF-");
		// The Hindi text is set in the bundled Noto Sans Devanagari, so Chromium shapes the conjuncts
		assertThat(new String(pdf, StandardCharsets.ISO_8859_1)).contains("NotoSansDevanagari");
		Path out = Path.of("target", "worksheet-hindi.pdf");
		Files.write(out, pdf);
		String html = renderer.html(UUID.fromString(id));
		assertThat(html).contains("lang=\"hi\"").contains("क्षत्रिय").contains("Answer key");

		// Printed: no new shuffle; a reprint after the 30 days uses the very same questions
		List<String> before = order(data(parent(get("/api/v1/family/parent/worksheets/" + id + "/solutions"), null)
			.andExpect(status().isOk())
			.andReturn()));
		parent(post("/api/v1/family/parent/worksheets/" + id + "/reshuffle"), null).andExpect(status().isConflict());
		systemQuery("UPDATE app.worksheets SET pdf_expires_at = now() - interval '1 minute' WHERE id = ? RETURNING id",
				UUID.fromString(id));
		parent(get("/api/v1/family/parent/worksheets/" + id + "/pdf"), null).andExpect(status().isAccepted())
			.andExpect(jsonPath("$.data.status").value("rendering"));
		assertThat(download(pdfUrl(id))).isNotEmpty();
		List<String> after = order(data(parent(get("/api/v1/family/parent/worksheets/" + id + "/solutions"), null)
			.andReturn()));
		assertThat(after).isEqualTo(before);
		assertThat(renderer.html(UUID.fromString(id))).isEqualTo(html);
	}

	@Test
	void shuffleAgainBeforePrintingAndWeakSpotsFeedAreasToWorkOn() throws Exception {
		List<String> prompts = new ArrayList<>();
		for (int i = 1; i <= 12; i++) {
			prompts.add("Question " + i);
		}
		UUID topic = topic(4, "Water", prompts);
		JsonNode created = create(4, topic, 6);
		String id = created.path("worksheet").path("id").asString();
		List<String> first = order(created);
		boolean changed = false;
		for (int i = 0; i < 5 && !changed; i++) {
			changed = !order(data(parent(post("/api/v1/family/parent/worksheets/" + id + "/reshuffle"), null)
				.andExpect(status().isOk())
				.andReturn())).equals(first);
		}
		assertThat(changed).isTrue();

		// Not enough questions, and the source must match
		parent(post("/api/v1/family/parent/worksheets"), """
				{ "child_id": "%s", "subject_id": 4, "source": "topic", "topic_id": "%s", "question_count": 20 }"""
			.formatted(childId, topic)).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.question_count").value("OUT_OF_RANGE"));
		parent(post("/api/v1/family/parent/worksheets"), """
				{ "child_id": "%s", "subject_id": 4, "source": "chapter", "topic_id": "%s", "question_count": 5 }"""
			.formatted(childId, topic)).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.family_chapter_id").value("REQUIRED"));

		// P13: solutions, then ticks; only the worksheet's topics
		JsonNode solutions = data(parent(get("/api/v1/family/parent/worksheets/" + id + "/solutions"), null)
			.andReturn());
		assertThat(solutions.path("questions").get(0).path("solution").path("correct").get(0).asString()).isEqualTo("a");
		parent(put("/api/v1/family/parent/worksheets/" + id + "/weak-spots"),
				"{ \"topic_ids\": [\"" + UUID.randomUUID() + "\"] }").andExpect(status().isBadRequest());
		parent(put("/api/v1/family/parent/worksheets/" + id + "/weak-spots"), "{ \"topic_ids\": [\"" + topic + "\"] }")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.weak_spots[0]").value(topic.toString()));
		parent(get("/api/v1/family/parent/children/" + childId + "/week"), null)
			.andExpect(jsonPath("$.data.areas[0].topic_id").value(topic.toString()))
			.andExpect(jsonPath("$.data.worksheets_done").value(1));
		parent(get("/api/v1/family/parent/worksheets?child_id=" + childId), null)
			.andExpect(jsonPath("$.data[0].id").value(id))
			.andExpect(jsonPath("$.data[0].source_title").value(org.hamcrest.Matchers.startsWith("Water")));

		// K6: the child starts it on screen, which counts as printed
		mvc.perform(post("/api/v1/family/kid/worksheets/" + id + "/onscreen").header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Child-Id", childId.toString())
			.header("Idempotency-Key", UUID.randomUUID().toString()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.questions.length()").value(6));
		parent(post("/api/v1/family/parent/worksheets/" + id + "/reshuffle"), null).andExpect(status().isConflict());
		assertThat(TestAws.BUCKET).isNotBlank();
	}

}
