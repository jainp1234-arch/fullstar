package com.fullstar.api.studio.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ContentSamples;
import com.fullstar.api.testsupport.StudioTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Plan 7.3: a report and a ticket each make the round trip and end as messages in P19. */
class SupportRoundTripTest extends StudioTestSupport {

	private String parentBearer;

	private String grant;

	private UUID familyId;

	private UUID lessonId;

	@BeforeEach
	void setUp() throws Exception {
		asStaff("content_admin");
		String subject = UUID.randomUUID().toString();
		parentBearer = TestTokens.token().subject(subject).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, parentBearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		MvcResult pin = mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, parentBearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andExpect(status().isCreated()).andReturn();
		grant = data(pin).path("parent_grant").asString();
		familyId = systemQuery("SELECT id FROM app.families WHERE keycloak_user_id = ?", subject);
		UUID topic = newTopic("evs");
		lessonId = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, lang, created_by)
				VALUES ('lesson', 'library', 3, 4, ?, 'en', ?) RETURNING id""", topic, staffId);
		UUID version = systemQuery("""
				INSERT INTO app.content_versions (item_id, version_no, title, body, created_by)
				VALUES (?, 1, 'Water lesson', CAST(? AS jsonb), ?) RETURNING id""", lessonId, ContentSamples.LESSON, staffId);
		systemQuery("INSERT INTO app.content_checks (version_id, status, model) VALUES (?, 'passed', 'manual') RETURNING id",
				version);
		systemQuery("""
				UPDATE app.content_items SET current_version_id = ?, published_version_id = ?, status = 'published',
				       published_at = now() WHERE id = ? RETURNING id""", version, version, lessonId);
	}

	private ResultActions parent(MockHttpServletRequestBuilder request, String json) throws Exception {
		request.header(HttpHeaders.AUTHORIZATION, parentBearer).header("X-Parent-Grant", grant);
		if (json != null) {
			request.contentType(MediaType.APPLICATION_JSON).content(json);
		}
		return mvc.perform(request);
	}

	@Test
	void aReportMarkedFixedReachesTheParentsMessages() throws Exception {
		String reportId = data(parent(post("/api/v1/family/parent/problem-reports"), """
				{ "content_item_id": "%s", "reason": "spelling", "note": "Scene 2" }""".formatted(lessonId))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.data.status").value("open"))
			.andReturn()).path("id").asString();
		parent(post("/api/v1/family/parent/problem-reports"), """
				{ "content_item_id": "%s", "reason": "typo" }""".formatted(lessonId)).andExpect(status().isBadRequest());
		parent(post("/api/v1/family/parent/problem-reports"), """
				{ "content_item_id": "%s", "reason": "other" }""".formatted(UUID.randomUUID()))
			.andExpect(status().isNotFound());

		fetch("/api/v1/studio/problem-reports").andExpect(status().isOk())
			.andExpect(jsonPath("$.data[?(@.id == '" + reportId + "')].title").value("Water lesson"))
			.andExpect(jsonPath("$.data[?(@.id == '" + reportId + "')].note").value("Scene 2"))
			.andExpect(jsonPath("$.data[?(@.id == '" + reportId + "')].family_ref").value(familyId.toString().substring(0, 8)));
		send(patch("/api/v1/studio/problem-reports/" + reportId), "{ \"status\": \"fixed\" }").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("fixed"));
		send(patch("/api/v1/studio/problem-reports/" + reportId), "{ \"status\": \"dismissed\" }")
			.andExpect(status().isConflict());

		parent(get("/api/v1/family/parent/messages"), null).andExpect(jsonPath("$.data.items[0].kind").value("report_fixed"))
			.andExpect(jsonPath("$.data.items[0].body").value("The lesson you reported has been fixed. Thank you for telling us."));
		fetch("/api/v1/studio/dashboard").andExpect(status().isOk());
	}

	@Test
	void aTicketReplyReachesTheParentAndTheParentCanAnswer() throws Exception {
		String ticketId = data(parent(post("/api/v1/family/parent/support-tickets"), """
				{ "subject": "Upload stuck", "body": "My EVS upload is still checking." }""")
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.data.status").value("open"))
			.andExpect(jsonPath("$.data.messages[0].author").value("parent"))
			.andReturn()).path("id").asString();

		fetch("/api/v1/studio/support-tickets").andExpect(status().isOk())
			.andExpect(jsonPath("$.data[?(@.id == '" + ticketId + "')].last_message").value("My EVS upload is still checking."));
		send(post("/api/v1/studio/support-tickets/" + ticketId + "/messages"), """
				{ "body": "It is ready now. Thank you for waiting!" }""").andExpect(status().isCreated())
			.andExpect(jsonPath("$.data.ticket.status").value("answered"))
			.andExpect(jsonPath("$.data.messages.length()").value(2));

		parent(get("/api/v1/family/parent/messages"), null).andExpect(jsonPath("$.data.items[0].kind").value("support_reply"))
			.andExpect(jsonPath("$.data.items[0].body").value("It is ready now. Thank you for waiting!"))
			.andExpect(jsonPath("$.data.items[0].link.screen").value("P16"));
		parent(post("/api/v1/family/parent/support-tickets/" + ticketId + "/messages"), "{ \"body\": \"Thanks!\" }")
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.data.status").value("open"))
			.andExpect(jsonPath("$.data.messages[1].author").value("staff"))
			.andExpect(jsonPath("$.data.messages[2].body").value("Thanks!"));
		parent(get("/api/v1/family/parent/support-tickets"), null).andExpect(jsonPath("$.data[0].id").value(ticketId));

		// Another family sees none of it
		String other = TestTokens.token().subject(UUID.randomUUID().toString()).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, other)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		String otherGrant = data(mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, other)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andReturn()).path("parent_grant").asString();
		mvc.perform(post("/api/v1/family/parent/support-tickets/" + ticketId + "/messages")
			.header(HttpHeaders.AUTHORIZATION, other)
			.header("X-Parent-Grant", otherGrant)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{ \"body\": \"hi\" }")).andExpect(status().isNotFound());
	}

}
