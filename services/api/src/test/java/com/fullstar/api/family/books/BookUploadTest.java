package com.fullstar.api.family.books;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.QueueUrls;
import com.fullstar.api.testsupport.ApiTestSupport;
import com.fullstar.api.testsupport.TestTokens;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Plan 5.1: books, signed uploads, the content check of files, limits and sharing with a sibling. */
class BookUploadTest extends ApiTestSupport {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final HttpClient HTTP = HttpClient.newHttpClient();

	private static final int EVS = 4;

	/** A few bytes that start like a JPEG. */
	private static final byte[] JPEG = { (byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 0x10, 'J', 'F', 'I',
			'F', 0 };

	@Autowired
	private SqsClient sqs;

	@Autowired
	private QueueUrls queueUrls;

	private String bearer;

	private String grant;

	private UUID childId;

	@BeforeEach
	void family() throws Exception {
		bearer = TestTokens.token().subject(UUID.randomUUID().toString()).bearer();
		mvc.perform(post("/api/v1/family/me").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"consent_version\": \"2026-10-v1\"}")).andExpect(status().isCreated());
		grant = data(mvc.perform(post("/api/v1/family/pin").header(HttpHeaders.AUTHORIZATION, bearer)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"pin\": \"1234\"}")).andExpect(status().isCreated()).andReturn()).path("parent_grant").asString();
		childId = addChild("Mia", 3);
	}

	private UUID addChild(String name, int classLevel) throws Exception {
		return UUID.fromString(data(send(post("/api/v1/family/parent/children"), """
				{ "first_name": "%s", "age": 8, "class_level": %d, "avatar_key": "cat" }""".formatted(name, classLevel))
			.andExpect(status().isCreated())
			.andReturn()).path("id").asString());
	}

	private ResultActions send(MockHttpServletRequestBuilder request, String json) throws Exception {
		return mvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)
			.contentType(MediaType.APPLICATION_JSON)
			.content(json));
	}

	private static JsonNode data(MvcResult result) throws Exception {
		return JSON.readTree(result.getResponse().getContentAsString()).path("data");
	}

	private String newBook(UUID child, String mode) throws Exception {
		return data(send(post("/api/v1/family/parent/books"), """
				{ "child_id": "%s", "subject_id": %d, "upload_mode": "%s" }""".formatted(child, EVS, mode))
			.andExpect(status().isCreated())
			.andReturn()).path("id").asString();
	}

	private static String photos(int count, long size) {
		List<String> files = new ArrayList<>();
		for (int i = 1; i <= count; i++) {
			files.add("{ \"name\": \"page-%d.jpg\", \"type\": \"image/jpeg\", \"size\": %d }".formatted(i, size));
		}
		return "[" + String.join(", ", files) + "]";
	}

	private static void put(JsonNode file, byte[] bytes) throws Exception {
		HttpResponse<Void> response = HTTP.send(HttpRequest.newBuilder(URI.create(file.path("url").asString()))
			.header("Content-Type", file.path("headers").path("Content-Type").asString())
			.PUT(HttpRequest.BodyPublishers.ofByteArray(bytes))
			.build(), HttpResponse.BodyHandlers.discarding());
		assertThat(response.statusCode()).as("PUT to storage").isEqualTo(200);
	}

	@Test
	void aTenPhotoChapterReachesScanningAndQueuesTheScan() throws Exception {
		String bookId = newBook(childId, "chapterwise");
		JsonNode upload = data(send(post("/api/v1/family/parent/books/" + bookId + "/uploads"), """
				{ "source": "photos", "chapter": { "number": 1, "title": "Plants around us" }, "files": %s }"""
			.formatted(photos(10, JPEG.length))).andExpect(status().isCreated())
			.andExpect(jsonPath("$.data.status").value("awaiting_files"))
			.andReturn());
		assertThat(upload.path("files").size()).isEqualTo(10);
		for (JsonNode file : upload.path("files")) {
			put(file, JPEG);
		}
		String uploadId = upload.path("id").asString();
		send(post("/api/v1/family/parent/uploads/" + uploadId + "/complete"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("scanning"));
		// Completing twice changes nothing
		send(post("/api/v1/family/parent/uploads/" + uploadId + "/complete"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("scanning"));

		String url = queueUrls.of(JobQueue.UPLOAD_SCAN);
		List<Message> messages = sqs.receiveMessage(r -> r.queueUrl(url).maxNumberOfMessages(10).waitTimeSeconds(5))
			.messages();
		assertThat(messages).anySatisfy(message -> {
			JsonNode envelope = JSON.readTree(message.body());
			assertThat(envelope.path("type").asString()).isEqualTo("upload.scan");
			assertThat(envelope.path("payload").path("upload_id").asString()).isEqualTo(uploadId);
			assertThat(envelope.path("payload").path("object_keys").size()).isEqualTo(10);
		});

		JsonNode rows = data(mvc.perform(get("/api/v1/family/parent/books?child_id=" + childId)
			.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)).andExpect(status().isOk()).andReturn());
		assertThat(rows.size()).isEqualTo(4);
		JsonNode evs = rows.get(3);
		assertThat(evs.path("subject").asString()).isEqualTo("evs");
		assertThat(evs.path("book").path("status").asString()).isEqualTo("getting_ready");
		assertThat(evs.path("book").path("chapters").get(0).path("title").asString()).isEqualTo("Plants around us");
		assertThat(evs.path("book").path("latest_upload").path("status").asString()).isEqualTo("scanning");
		assertThat(rows.get(0).path("book").isNull()).isTrue();
	}

	@Test
	void overLimitFilesAreRefused() throws Exception {
		String bookId = newBook(childId, "chapterwise");
		String base = "/api/v1/family/parent/books/" + bookId + "/uploads";
		String chapter = "\"chapter\": { \"number\": 1, \"title\": \"Water\" }";
		send(post(base), "{ \"source\": \"photos\", %s, \"files\": %s }".formatted(chapter, photos(51, 100)))
			.andExpect(status().isContentTooLarge())
			.andExpect(jsonPath("$.error.code").value("UPLOAD_LIMIT"));
		send(post(base), "{ \"source\": \"photos\", %s, \"files\": %s }".formatted(chapter, photos(1, 10_485_761)))
			.andExpect(status().isContentTooLarge());
		send(post(base), """
				{ "source": "pdf", %s, "files": [ { "name": "a.pdf", "type": "application/pdf", "size": 52428801 } ] }"""
			.formatted(chapter)).andExpect(status().isContentTooLarge());
		send(post(base), """
				{ "source": "pdf", %s, "files": [ { "name": "a.pdf", "type": "application/pdf", "size": 10 },
				                                   { "name": "b.pdf", "type": "application/pdf", "size": 10 } ] }"""
			.formatted(chapter)).andExpect(status().isContentTooLarge());
		send(post(base), """
				{ "source": "photos", %s, "files": [ { "name": "a.gif", "type": "image/gif", "size": 10 } ] }"""
			.formatted(chapter)).andExpect(status().isContentTooLarge());
		Long chapters = systemQuery("SELECT count(*) FROM app.family_chapters WHERE family_book_id = ?",
				UUID.fromString(bookId));
		assertThat(chapters).isZero();
	}

	@Test
	void aFileThatIsNotWhatItSaysIsRejectedAndMissingFilesAreReported() throws Exception {
		String bookId = newBook(childId, "chapterwise");
		JsonNode upload = data(send(post("/api/v1/family/parent/books/" + bookId + "/uploads"), """
				{ "source": "photos", "chapter": { "number": 2, "title": "Animals" }, "files": %s }"""
			.formatted(photos(2, 11))).andExpect(status().isCreated()).andReturn());
		String uploadId = upload.path("id").asString();
		put(upload.path("files").get(0), JPEG);
		send(post("/api/v1/family/parent/uploads/" + uploadId + "/complete"), "").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields['files[1]']").value("REQUIRED"));

		byte[] notAnImage = Arrays.copyOf("MZ-not-a-photo".getBytes(), 11);
		put(upload.path("files").get(1), notAnImage);
		send(post("/api/v1/family/parent/uploads/" + uploadId + "/complete"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.data.status").value("rejected"))
			.andExpect(jsonPath("$.data.reject_reason").value("wrong_type"));
		String chapter = systemQuery("SELECT status FROM app.family_chapters WHERE family_book_id = ?",
				UUID.fromString(bookId));
		assertThat(chapter).isEqualTo("needs_attention");
	}

	@Test
	void oneBookPerSubjectSharedOnlyWithASiblingInTheSameClass() throws Exception {
		String bookId = newBook(childId, "whole");
		send(post("/api/v1/family/parent/books"), """
				{ "child_id": "%s", "subject_id": %d, "upload_mode": "whole" }""".formatted(childId, EVS))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("BOOK_EXISTS"));

		UUID sister = addChild("Asha", 3);
		send(post("/api/v1/family/parent/books/" + bookId + "/share"), "{ \"child_id\": \"%s\" }".formatted(sister))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.child_ids.length()").value(2));
		String bookOfSister = systemQuery("SELECT family_book_id::text FROM app.child_books WHERE child_id = ?", sister);
		assertThat(bookOfSister).isEqualTo(bookId);

		systemQuery("DELETE FROM app.children WHERE id = ? RETURNING id", sister);
		UUID brother = addChild("Kabir", 4);
		send(post("/api/v1/family/parent/books/" + bookId + "/share"), "{ \"child_id\": \"%s\" }".formatted(brother))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("BOOK_MISMATCH"));
	}

	@Test
	void aWholeBookTakesNoChapterAndOnlyOneUpload() throws Exception {
		String bookId = newBook(childId, "whole");
		String base = "/api/v1/family/parent/books/" + bookId + "/uploads";
		String pdf = "[ { \"name\": \"book.pdf\", \"type\": \"application/pdf\", \"size\": 2000 } ]";
		send(post(base), "{ \"source\": \"pdf\", \"chapter\": { \"number\": 1, \"title\": \"x\" }, \"files\": %s }"
			.formatted(pdf)).andExpect(status().isBadRequest());
		JsonNode upload = data(send(post(base), "{ \"source\": \"pdf\", \"files\": %s }".formatted(pdf))
			.andExpect(status().isCreated())
			.andReturn());
		assertThat(upload.path("family_chapter_id").isNull()).isTrue();
		send(post(base), "{ \"source\": \"pdf\", \"files\": %s }".formatted(pdf)).andExpect(status().isConflict())
			.andExpect(jsonPath("$.error.code").value("BOOK_EXISTS"));
	}

	@Test
	void chaptersCanBeRenamedRenumberedAndDeleted() throws Exception {
		String bookId = newBook(childId, "chapterwise");
		String base = "/api/v1/family/parent/books/" + bookId + "/uploads";
		for (int n = 1; n <= 2; n++) {
			send(post(base), "{ \"source\": \"photos\", \"chapter\": { \"number\": %d, \"title\": \"Ch %d\" }, \"files\": %s }"
				.formatted(n, n, photos(1, 11))).andExpect(status().isCreated());
		}
		send(post(base), "{ \"source\": \"photos\", \"chapter\": { \"number\": 2, \"title\": \"Again\" }, \"files\": %s }"
			.formatted(photos(1, 11))).andExpect(status().isConflict());
		JsonNode chapters = data(mvc.perform(get("/api/v1/family/parent/books/" + bookId + "/chapters")
			.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)).andReturn());
		String first = chapters.get(0).path("id").asString();
		send(patch("/api/v1/family/parent/chapters/" + first), "{ \"title\": \"Our plants\", \"number\": 3 }")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.data.number").value(3))
			.andExpect(jsonPath("$.data.title").value("Our plants"));
		send(patch("/api/v1/family/parent/chapters/" + first), "{ \"number\": 0, \"pages\": 2 }")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error.fields.number").value("OUT_OF_RANGE"))
			.andExpect(jsonPath("$.error.fields.pages").value("INVALID"));
		send(delete("/api/v1/family/parent/chapters/" + first), "").andExpect(status().isOk());
		Long left = systemQuery("SELECT count(*) FROM app.family_chapters WHERE family_book_id = ?",
				UUID.fromString(bookId));
		assertThat(left).isEqualTo(1L);
	}

	@Test
	void anotherFamilysBookIsNotFound() throws Exception {
		String bookId = newBook(childId, "chapterwise");
		family();
		mvc.perform(get("/api/v1/family/parent/books/" + bookId + "/chapters")
			.header(HttpHeaders.AUTHORIZATION, bearer)
			.header("X-Parent-Grant", grant)).andExpect(status().isNotFound());
		send(post("/api/v1/family/parent/books/" + bookId + "/uploads"), "{ \"source\": \"photos\", \"files\": %s }"
			.formatted(photos(1, 11))).andExpect(status().isNotFound());
	}

}
