package com.fullstar.bookreader;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.bookreader.pages.FakeTools;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

/** Plan 5.3: book-process on ElasticMQ and SeaweedFS with fake OCR and WebP. */
class BookProcessFlowTest extends TestCloud {

	@Autowired
	private FakeTools tools;

	/** A PDF whose pages carry these lines as a real text layer. */
	private static byte[] pdf(List<List<String>> pages) throws IOException {
		try (PDDocument document = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
			for (List<String> lines : pages) {
				PDPage page = new PDPage();
				document.addPage(page);
				try (PDPageContentStream content = new PDPageContentStream(document, page)) {
					content.beginText();
					content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 14);
					content.newLineAtOffset(60, 700);
					content.setLeading(20);
					for (String line : lines) {
						content.showText(line);
						content.newLine();
					}
					content.endText();
				}
			}
			document.save(out);
			return out.toByteArray();
		}
	}

	private static byte[] photo(boolean withText) throws IOException {
		BufferedImage image = new BufferedImage(400, 560, BufferedImage.TYPE_INT_RGB);
		Graphics2D g = image.createGraphics();
		g.setColor(Color.WHITE);
		g.fillRect(0, 0, 400, 560);
		if (withText) {
			g.setColor(Color.BLACK);
			g.drawString("Plants need water.", 40, 80);
		}
		g.dispose();
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		ImageIO.write(image, "jpg", out);
		return out.toByteArray();
	}

	private JsonNode process(String mode, String langs, List<Map<String, String>> files) {
		String key = "book.process:" + UUID.randomUUID();
		String familyId = UUID.randomUUID().toString();
		send("book-process", envelope("book.process", key, Map.of("upload_id", UUID.randomUUID().toString(),
				"family_id", familyId, "mode", mode, "langs", langs, "files", files)));
		JsonNode payload = resultFor(key).path("payload");
		assertThat(payload.path("outcome").asString()).isEqualTo("success");
		return payload.path("result");
	}

	private static Map<String, String> file(String key, String type) {
		return Map.of("file_id", UUID.randomUUID().toString(), "object_key", key, "content_type", type);
	}

	@Test
	void aWholePdfBookBecomesPagesWithItsTextLayerAndSuggestedChapters() throws Exception {
		String key = put(pdf(List.of(List.of("My EVS Book", "Class 3"),
				List.of("Chapter 1", "Plants around us", "Look around you. Trees, bushes and grass are all plants."),
				List.of("Chapter 2", "Water", "All living things need water to live and grow."))));
		int ocrBefore = tools.ocrCalls();
		JsonNode result = process("whole", "eng", List.of(file(key, "application/pdf")));
		assertThat(result.path("page_count").asInt()).isEqualTo(3);

		JsonNode full = json.readTree(get(result.path("result_key").asString()));
		JsonNode pages = full.path("pages");
		assertThat(pages.size()).isEqualTo(3);
		assertThat(pages.get(1).path("text").asString()).contains("Plants around us");
		assertThat(pages.get(1).path("confidence").asDouble()).isEqualTo(100.0);
		assertThat(pages.get(1).path("quality").asString()).isEqualTo("ok");
		assertThat(new String(get(pages.get(1).path("image_key").asString()))).startsWith("RIFF-fake-WEBP");
		// The cover has too little text for its layer, so only it was read with OCR
		assertThat(tools.ocrCalls() - ocrBefore).isEqualTo(1);
		JsonNode chapters = full.path("suggested_chapters");
		assertThat(chapters.size()).isEqualTo(2);
		assertThat(chapters.get(0).path("title").asString()).isEqualTo("Plants around us");
		assertThat(chapters.get(0).path("start_page").asInt()).isEqualTo(1);
		assertThat(chapters.get(1).path("start_page").asInt()).isEqualTo(3);
	}

	@Test
	void chapterPhotosAreReadWithOcrAndABlankOneIsUnclear() throws Exception {
		String clear = put(photo(true));
		String blank = put(photo(false));
		JsonNode result = process("chapterwise", "hin+eng",
				List.of(file(clear, "image/jpeg"), file(blank, "image/jpeg")));
		assertThat(result.path("unclear_pages").asInt()).isEqualTo(1);
		JsonNode full = json.readTree(get(result.path("result_key").asString()));
		assertThat(full.path("pages").get(0).path("quality").asString()).isEqualTo("ok");
		assertThat(full.path("pages").get(0).path("text").asString()).endsWith("(hin+eng)");
		assertThat(full.path("pages").get(1).path("quality").asString()).isEqualTo("unclear");
		assertThat(full.path("suggested_chapters").isEmpty()).isTrue();
	}

	@Test
	void tooManyPagesOrAnUnreadableFileIsRefusedNotRetried() throws Exception {
		List<List<String>> many = java.util.stream.IntStream.rangeClosed(1, 301).mapToObj(i -> List.of("Page " + i)).toList();
		JsonNode tooMany = process("whole", "eng", List.of(file(put(pdf(many)), "application/pdf")));
		assertThat(tooMany.path("rejected").asString()).isEqualTo("too_many_pages");

		JsonNode broken = process("whole", "eng", List.of(file(put("%PDF-1.7 not really".getBytes()), "application/pdf")));
		assertThat(broken.path("rejected").asString()).isEqualTo("unreadable");
	}

}
