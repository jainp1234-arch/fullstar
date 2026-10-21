package com.fullstar.api.family.parent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Step 3.2: change, remove and promote a child, and the one-time data deletion request (Schema §11). */
class ChildrenManagementTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final String CHILDREN = "/api/v1/family/parent/children/";

	private static final String DELETION = "/api/v1/family/parent/deletion-request";

	private record Parent(String subject, String bearer, UUID familyId, String grant) {
	}

	private Parent setUp() throws Exception {
		String subject = UUID.randomUUID().toString();
		String bearer = TestTokens.token().subject(subject).bearer();
		MvcResult me = mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}"))
			.andExpect(status().isCreated())
			.andReturn();
		UUID familyId = UUID.fromString(data(me).path("family").path("id").asString());
		MvcResult pin = mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}"))
			.andExpect(status().isCreated())
			.andReturn();
		return new Parent(subject, bearer, familyId, data(pin)
			.path("parent_grant")
			.asString());
	}

	private static JsonNode data(MvcResult result) throws Exception {
		return JSON.readTree(result.getResponse().getContentAsString()).path("data");
	}

	private MockHttpServletRequestBuilder authed(MockHttpServletRequestBuilder request, Parent parent) {
		return request.header(HttpHeaders.AUTHORIZATION, parent.bearer()).header("X-Parent-Grant", parent.grant());
	}

	private UUID addChild(Parent parent, int classLevel) throws Exception {
		MvcResult result = mvc.perform(authed(post("/api/v1/family/parent/children"), parent)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"first_name\": \"Mia\", \"age\": 7, \"class_level\": " + classLevel + ", \"avatar_key\": \"cat\"}"))
			.andExpect(status().isCreated())
			.andReturn();
		return UUID.fromString(data(result).path("id").asString());
	}

	private ResultActions patchChild(Parent parent, String id, String json) throws Exception {
		return mvc.perform(authed(patch(CHILDREN + id), parent).contentType(MediaType.APPLICATION_JSON).content(json));
	}

	private ResultActions move(Parent parent, UUID id, String key) throws Exception {
		MockHttpServletRequestBuilder request = authed(post(CHILDREN + id + "/move-to-next-class"), parent);
		if (key != null) {
			request.header("Idempotency-Key", key);
		}
		return mvc.perform(request);
	}

	private static long count(String sql, Object... params) {
		Long count = systemQuery(sql, params);
		return count;
	}

	/** Progress of every kind that the move and the delete must erase (one row each). */
	private static void addProgress(Parent parent, UUID child, int classLevel) {
		UUID familyId = parent.familyId();
		UUID topic = systemQuery("""
				INSERT INTO app.topics (class_level, subject_id, name) VALUES (3, 3, ?) RETURNING id""",
				"Topic " + UUID.randomUUID());
		UUID staff = systemQuery("""
				INSERT INTO app.staff_users (keycloak_user_id, display_name, role)
				VALUES (?, 'Staff', 'content_admin') RETURNING id""", "kc-" + UUID.randomUUID());
		UUID question = systemQuery("""
				INSERT INTO app.content_items (kind, scope, class_level, subject_id, topic_id, question_type, lang, created_by)
				VALUES ('question', 'library', 3, 3, ?, 'mcq', 'en', ?) RETURNING id""", topic, staff);
		UUID book = systemQuery("""
				INSERT INTO app.family_books (family_id, subject_id, class_level, upload_mode)
				VALUES (?, 3, ?, 'whole') RETURNING id""", familyId, (short) classLevel);
		systemQuery("""
				INSERT INTO app.child_books (child_id, subject_id, family_book_id, family_id)
				VALUES (?, 3, ?, ?) RETURNING child_id""", child, book, familyId);
		systemQuery("""
				INSERT INTO app.activity_attempts (id, family_id, child_id, kind, subject_id, started_at, stars)
				VALUES (?, ?, ?, 'lesson', 3, now(), 3) RETURNING id""", UUID.randomUUID(), familyId, child);
		systemQuery("""
				INSERT INTO app.mistakes (child_id, question_item_id, family_id, topic_id, last_wrong_at)
				VALUES (?, ?, ?, ?, now()) RETURNING child_id""", child, question, familyId, topic);
		systemQuery("""
				INSERT INTO app.usage_minutes (child_id, minute_at, family_id)
				VALUES (?, date_trunc('minute', now()), ?) RETURNING child_id""", child, familyId);
		systemQuery("""
				INSERT INTO app.worksheets (family_id, child_id, subject_id, source, topic_id, question_count, shuffle_seed)
				VALUES (?, ?, 3, 'topic', ?, 10, 1) RETURNING id""", familyId, child, topic);
		systemQuery("UPDATE app.children SET stars_total = 9 WHERE id = ? RETURNING id", child);
	}

	private static long progressRows(UUID child) {
		long total = 0;
		for (String table : List.of("activity_attempts", "mistakes", "usage_minutes", "worksheets", "child_books")) {
			total += count("SELECT count(*) FROM app." + table + " WHERE child_id = ?", child);
		}
		return total;
	}

	@Test
	void patchChangesOnlyTheGivenFields() throws Exception {
		Parent parent = setUp();
		UUID id = addChild(parent, 2);

		patchChild(parent, id.toString(), "{\"first_name\": \"  Leo  \"}").andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("success"))
			.andExpect(jsonPath("$.data.id").value(id.toString()))
			.andExpect(jsonPath("$.data.first_name").value("Leo"))
			.andExpect(jsonPath("$.data.age").value(7))
			.andExpect(jsonPath("$.data.class_level").value(2))
			.andExpect(jsonPath("$.data.avatar_key").value("cat"))
			.andExpect(jsonPath("$.data.stars_total").value(0));
		patchChild(parent, id.toString(), "{\"age\": 9, \"avatar_key\": \"fox\"}").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.first_name").value("Leo"))
			.andExpect(jsonPath("$.data.age").value(9))
			.andExpect(jsonPath("$.data.avatar_key").value("fox"));
		patchChild(parent, id.toString(), "{}").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.age").value(9));
		mvc.perform(authed(get("/api/v1/family/me"), parent))
			.andExpect(jsonPath("$.data.children[0].first_name").value("Leo"));
	}

	@Test
	void patchReportsEachInvalidField() throws Exception {
		Parent parent = setUp();
		String id = addChild(parent, 2).toString();

		patchChild(parent, id, "{\"first_name\": \"   \"}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.error.fields.first_name").value("REQUIRED"));
		patchChild(parent, id, "{\"first_name\": null, \"age\": null, \"avatar_key\": null}")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.first_name").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields.age").value("REQUIRED"))
			.andExpect(jsonPath("$.error.fields.avatar_key").value("REQUIRED"));
		patchChild(parent, id, "{\"first_name\": \"" + "x".repeat(41) + "\"}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.first_name").value("INVALID_LENGTH"));
		patchChild(parent, id, "{\"age\": 3}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.age").value("OUT_OF_RANGE"));
		patchChild(parent, id, "{\"age\": 13}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.age").value("OUT_OF_RANGE"));
		patchChild(parent, id, "{\"age\": \"7\"}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.age").value("INVALID"));
		patchChild(parent, id, "{\"avatar_key\": \"dragon\"}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.avatar_key").value("INVALID"));
		patchChild(parent, id, "{\"class_level\": 3}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.error.fields.class_level").value("INVALID"));
		patchChild(parent, id, "{\"class_level\": null}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.class_level").value("INVALID"));
		assertThat(count("SELECT count(*) FROM app.children WHERE id = ? AND class_level = 2 AND age = 7",
				UUID.fromString(id))).isEqualTo(1L);
	}

	@Test
	void unknownMalformedAndForeignIdsAreNotFound() throws Exception {
		Parent parent = setUp();
		Parent other = setUp();
		UUID theirs = addChild(other, 2);
		addProgress(other, theirs, 2);

		for (String id : List.of(theirs.toString(), UUID.randomUUID().toString(), "not-a-uuid")) {
			patchChild(parent, id, "{\"first_name\": \"Eve\"}").andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
			mvc.perform(authed(delete(CHILDREN + id), parent)).andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
			move(parent, UUID.nameUUIDFromBytes(id.getBytes()), null).andExpect(status().isNotFound());
		}
		mvc.perform(authed(post(CHILDREN + theirs + "/move-to-next-class"), parent)).andExpect(status().isNotFound());
		mvc.perform(authed(post(CHILDREN + "not-a-uuid/move-to-next-class"), parent))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));

		assertThat(count("SELECT count(*) FROM app.children WHERE id = ? AND class_level = 2 AND first_name = 'Mia'",
				theirs)).isEqualTo(1L);
		assertThat(progressRows(theirs)).isEqualTo(5L);
	}

	@Test
	void deleteRemovesTheChildAndItsRows() throws Exception {
		Parent parent = setUp();
		UUID keep = addChild(parent, 3);
		UUID gone = addChild(parent, 3);
		addProgress(parent, keep, 3);
		addProgress(parent, gone, 3);
		assertThat(progressRows(gone)).isEqualTo(5L);
		assertThat(count("SELECT count(*) FROM app.answer_events WHERE child_id = ?", gone)).isZero();

		mvc.perform(authed(delete(CHILDREN + gone), parent)).andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("success"))
			.andExpect(jsonPath("$.data.id").value(gone.toString()));

		assertThat(count("SELECT count(*) FROM app.children WHERE id = ?", gone)).isZero();
		assertThat(progressRows(gone)).isZero();
		assertThat(progressRows(keep)).isEqualTo(5L);
		mvc.perform(authed(get("/api/v1/family/me"), parent)).andExpect(jsonPath("$.data.children", hasSize(1)));
		mvc.perform(authed(delete(CHILDREN + gone), parent)).andExpect(status().isNotFound());

		// Removing the last child is allowed
		mvc.perform(authed(delete(CHILDREN + keep), parent)).andExpect(status().isOk());
		mvc.perform(authed(get("/api/v1/family/me"), parent)).andExpect(jsonPath("$.data.children", hasSize(0)));
		assertThat(progressRows(keep)).isZero();
	}

	@Test
	void moveToNextClassErasesProgressAndStopsAtClassFive() throws Exception {
		Parent parent = setUp();
		UUID id = addChild(parent, 4);
		addProgress(parent, id, 4);

		move(parent, id, null).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.id").value(id.toString()))
			.andExpect(jsonPath("$.data.class_level").value(5))
			.andExpect(jsonPath("$.data.stars_total").value(0))
			.andExpect(jsonPath("$.data.first_name").value("Mia"));
		assertThat(progressRows(id)).isZero();

		move(parent, id, null).andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("MAX_CLASS"));
		mvc.perform(authed(get("/api/v1/family/me"), parent))
			.andExpect(jsonPath("$.data.children[0].class_level").value(5));
	}

	@Test
	void aRetriedMoveWithTheSameKeyDoesNotMoveTwice() throws Exception {
		Parent parent = setUp();
		UUID id = addChild(parent, 1);
		String key = UUID.randomUUID().toString();

		move(parent, id, key).andExpect(status().isOk())
			.andExpect(header().doesNotExist("Idempotent-Replayed"))
			.andExpect(jsonPath("$.data.class_level").value(2));
		move(parent, id, key).andExpect(status().isOk())
			.andExpect(header().string("Idempotent-Replayed", "true"))
			.andExpect(jsonPath("$.data.class_level").value(2));

		assertThat(count("SELECT count(*) FROM app.children WHERE id = ? AND class_level = 2", id)).isEqualTo(1L);
		move(parent, id, UUID.randomUUID().toString()).andExpect(jsonPath("$.data.class_level").value(3));
	}

	@Test
	void deletionRequestIsRecordedOnce() throws Exception {
		Parent parent = setUp();
		mvc.perform(authed(get("/api/v1/family/me"), parent))
			.andExpect(jsonPath("$.data.family.deletion_requested_at").value((Object) null));

		MvcResult first = mvc.perform(authed(post(DELETION), parent)).andExpect(status().isCreated())
			.andExpect(jsonPath("$.status").value("success"))
			.andReturn();
		Instant requestedAt = Instant.parse(data(first).path("requested_at").asString());
		Instant dueBy = Instant.parse(data(first).path("due_by").asString());
		assertThat(dueBy).isEqualTo(requestedAt.plusSeconds(30L * 24 * 3600));
		assertThat(requestedAt).isBetween(Instant.now().minusSeconds(60), Instant.now().plusSeconds(60));

		MvcResult second = mvc.perform(authed(post(DELETION), parent)).andExpect(status().isOk()).andReturn();
		assertThat(data(second).path("requested_at").asString()).isEqualTo(data(first).path("requested_at").asString());
		assertThat(data(second).path("due_by").asString()).isEqualTo(data(first).path("due_by").asString());

		assertThat(count("SELECT count(*) FROM app.deletion_requests WHERE family_id = ?", parent.familyId()))
			.isEqualTo(1L);
		assertThat((String) systemQuery("SELECT keycloak_user_id FROM app.deletion_requests WHERE family_id = ?",
				parent.familyId())).isEqualTo(parent.subject());
		assertThat((String) systemQuery("SELECT status FROM app.deletion_requests WHERE family_id = ?",
				parent.familyId())).isEqualTo("pending");
		mvc.perform(authed(get("/api/v1/family/me"), parent)).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.family.deletion_requested_at").isString());
		JsonNode me = data(mvc.perform(authed(get("/api/v1/family/me"), parent)).andReturn());
		assertThat(Instant.parse(me.path("family").path("deletion_requested_at").asString()))
			.isEqualTo(requestedAt);
	}

	@Test
	void anotherFamilysDeletionRequestIsIndependent() throws Exception {
		Parent parent = setUp();
		Parent other = setUp();
		mvc.perform(authed(post(DELETION), parent)).andExpect(status().isCreated());
		mvc.perform(authed(post(DELETION), other)).andExpect(status().isCreated());
		assertThat(count("SELECT count(*) FROM app.deletion_requests WHERE family_id IN (?, ?)", parent.familyId(),
				other.familyId())).isEqualTo(2L);
	}

	@Test
	void everyNewEndpointNeedsTheParentGrant() throws Exception {
		Parent parent = setUp();
		UUID id = addChild(parent, 2);
		String bearer = parent.bearer();
		List<MockHttpServletRequestBuilder> requests = List.of(
				patch(CHILDREN + id).contentType(MediaType.APPLICATION_JSON).content("{\"age\": 8}"),
				delete(CHILDREN + id), post(CHILDREN + id + "/move-to-next-class"), post(DELETION));
		for (MockHttpServletRequestBuilder request : requests) {
			mvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer)).andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("PIN_REQUIRED"));
		}
		assertThat(count("SELECT count(*) FROM app.children WHERE id = ? AND class_level = 2 AND age = 7", id))
			.isEqualTo(1L);
		assertThat(count("SELECT count(*) FROM app.deletion_requests WHERE family_id = ?", parent.familyId()))
			.isZero();
	}

	@Test
	void publicConfigHasNoPrivacyNoticeUrlWhenUnset() throws Exception {
		mvc.perform(get("/api/v1/public/config")).andExpect(status().isOk())
			.andExpect(jsonPath("$.data.privacy_notice_url").value((Object) null))
			.andExpect(jsonPath("$.data.consent_version").value("2026-10-v1"));
		JsonNode config = data(mvc.perform(get("/api/v1/public/config")).andReturn());
		assertThat(config.has("privacy_notice_url")).isTrue();
	}

}
