package com.fullstar.bookreader.pages;

import com.fullstar.bookreader.config.ReaderProperties;
import com.fullstar.bookreader.jobs.JobEnvelope;
import com.fullstar.bookreader.jobs.JobHandler;
import com.fullstar.bookreader.resilience.ResilientCalls;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The book-process job (Schema §12; Plan 5.3). Every page of the upload becomes a WebP image
 * (pages/&lt;page_id&gt;.webp) and text: a PDF's own text layer when it has one, otherwise Tesseract
 * (eng, or hin+eng for Hindi books). A page with low confidence or almost no text is "unclear".
 * Whole books also get suggested chapters. The full result is written to storage next to the upload
 * (uploads/&lt;upload_id&gt;/pages.json), because SQS messages are limited to 256 KB; the job result
 * carries its key.
 */
@Component
public class BookProcessHandler implements JobHandler {

	private static final Logger log = LoggerFactory.getLogger(BookProcessHandler.class);

	/** Schema §4.3 and the PRD: a PDF may have up to 300 pages. */
	static final int MAX_PAGES = 300;

	/** Below this mean word confidence a page is unclear (Plan 5.3). */
	static final double UNCLEAR_BELOW = 60;

	/** Fewer letters than this on a page is unclear too (a photo of nothing readable). */
	static final int MIN_LETTERS = 15;

	/** A PDF page with at least this many letters in its text layer is not OCRed. */
	static final int TEXT_LAYER_LETTERS = 40;

	private static final float RENDER_DPI = 150;

	private static final int WEBP_WIDTH = 1200;

	private final S3Client s3;

	private final PageTools.Ocr ocr;

	private final PageTools.Webp webp;

	private final ResilientCalls calls;

	private final JsonMapper json;

	private final String bucket;

	public BookProcessHandler(S3Client s3, PageTools.Ocr ocr, PageTools.Webp webp, ResilientCalls calls,
			JsonMapper json, ReaderProperties properties) {
		this.s3 = s3;
		this.ocr = ocr;
		this.webp = webp;
		this.calls = calls;
		this.json = json;
		this.bucket = properties.storage().bucket();
	}

	@Override
	public String queue() {
		return "book-process";
	}

	@Override
	public String type() {
		return "book.process";
	}

	private record PageImage(String fileId, Path png, String layerText) {
	}

	/** Not usable as uploaded (too many pages, unreadable): reported as a result, not retried. */
	private static final class Refused extends RuntimeException {

		private final String reason;

		Refused(String reason) {
			super(reason);
			this.reason = reason;
		}

	}

	@Override
	public JsonNode handle(JobEnvelope job) {
		JsonNode payload = job.payload();
		String familyId = payload.path("family_id").asString();
		String uploadId = payload.path("upload_id").asString();
		String langs = payload.path("langs").asString("eng");
		Path dir = null;
		try {
			dir = Files.createTempDirectory("book-process-");
			List<PageImage> images = new ArrayList<>();
			for (JsonNode file : payload.path("files")) {
				images.addAll(pages(file, dir));
				if (images.size() > MAX_PAGES) {
					throw new Refused("too_many_pages");
				}
			}
			if (images.isEmpty()) {
				throw new Refused("unreadable");
			}
			List<Map<String, Object>> pages = new ArrayList<>();
			List<String> texts = new ArrayList<>();
			int unclear = 0;
			for (int i = 0; i < images.size(); i++) {
				PageImage image = images.get(i);
				PageTools.OcrText text = image.layerText() != null ? new PageTools.OcrText(image.layerText(), 100)
						: ocr.read(image.png(), langs);
				String quality = unclear(text) ? "unclear" : "ok";
				unclear += "unclear".equals(quality) ? 1 : 0;
				String pageId = UUID.randomUUID().toString();
				String key = "families/" + familyId + "/pages/" + pageId + ".webp";
				byte[] bytes = webp.encode(image.png(), WEBP_WIDTH);
				calls.run(ResilientCalls.R2,
						() -> s3.putObject(put -> put.bucket(bucket).key(key).contentType("image/webp"), RequestBody.fromBytes(bytes)));
				Map<String, Object> page = new LinkedHashMap<>();
				page.put("page_id", pageId);
				page.put("page_no", i + 1);
				page.put("file_id", image.fileId());
				page.put("image_key", key);
				page.put("text", text.text());
				page.put("confidence", Math.round(text.confidence() * 100) / 100.0);
				page.put("quality", quality);
				pages.add(page);
				texts.add(text.text());
			}
			// Only a whole book is split; a chapter upload and a retaken page keep their chapter
			boolean split = "whole".equals(payload.path("mode").asString()) && !payload.hasNonNull("retake_page_id");
			List<ChapterSplitter.Suggestion> suggested = split ? ChapterSplitter.suggest(texts) : List.of();
			Map<String, Object> full = new LinkedHashMap<>();
			full.put("pages", pages);
			full.put("suggested_chapters", suggested.stream()
				.map(s -> Map.of("number", s.number(), "title", s.title(), "start_page", s.startPage()))
				.toList());
			String resultKey = "families/" + familyId + "/uploads/" + uploadId + "/pages.json";
			byte[] body = json.writeValueAsBytes(full);
			calls.run(ResilientCalls.R2, () -> s3.putObject(
					put -> put.bucket(bucket).key(resultKey).contentType("application/json"), RequestBody.fromBytes(body)));
			log.atInfo()
				.addKeyValue("upload_id", uploadId)
				.addKeyValue("pages", pages.size())
				.addKeyValue("unclear", unclear)
				.addKeyValue("chapters", suggested.size())
				.log("Book processed");
			return json.valueToTree(Map.of("result_key", resultKey, "page_count", pages.size(), "unclear_pages", unclear));
		}
		catch (Refused ex) {
			log.atInfo().addKeyValue("upload_id", uploadId).log("Upload refused: {}", ex.reason);
			return json.valueToTree(Map.of("rejected", ex.reason));
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		finally {
			delete(dir);
		}
	}

	static boolean unclear(PageTools.OcrText text) {
		long letters = text.text().codePoints().filter(Character::isLetterOrDigit).count();
		return text.confidence() < UNCLEAR_BELOW || letters < MIN_LETTERS;
	}

	/** The page images of one uploaded file, in order, as PNG files in dir. */
	private List<PageImage> pages(JsonNode file, Path dir) throws IOException {
		String key = file.path("object_key").asString();
		String fileId = file.path("file_id").asString();
		Path source = dir.resolve(UUID.randomUUID().toString());
		calls.run(ResilientCalls.R2, () -> {
			try {
				Files.deleteIfExists(source);
			}
			catch (IOException ex) {
				throw new UncheckedIOException(ex);
			}
			s3.getObject(get -> get.bucket(bucket).key(key), source);
		});
		List<PageImage> out = new ArrayList<>();
		if ("application/pdf".equals(file.path("content_type").asString())) {
			PDDocument pdf;
			try {
				pdf = Loader.loadPDF(source.toFile());
			}
			catch (IOException ex) {
				throw new Refused("unreadable");
			}
			try (pdf) {
				if (pdf.getNumberOfPages() > MAX_PAGES) {
					throw new Refused("too_many_pages");
				}
				PDFRenderer renderer = new PDFRenderer(pdf);
				PDFTextStripper stripper = new PDFTextStripper();
				for (int i = 0; i < pdf.getNumberOfPages(); i++) {
					stripper.setStartPage(i + 1);
					stripper.setEndPage(i + 1);
					String layer = stripper.getText(pdf).strip();
					long letters = layer.codePoints().filter(Character::isLetterOrDigit).count();
					Path png = dir.resolve("page-" + UUID.randomUUID() + ".png");
					ImageIO.write(renderer.renderImageWithDPI(i, RENDER_DPI, ImageType.GRAY), "png", png.toFile());
					out.add(new PageImage(fileId, png, letters >= TEXT_LAYER_LETTERS ? layer : null));
				}
			}
		}
		else {
			BufferedImage photo = ImageIO.read(source.toFile());
			if (photo == null) {
				throw new Refused("unreadable");
			}
			Path png = dir.resolve("page-" + UUID.randomUUID() + ".png");
			ImageIO.write(photo, "png", png.toFile());
			out.add(new PageImage(fileId, png, null));
		}
		Files.deleteIfExists(source);
		return out;
	}

	private static void delete(Path dir) {
		if (dir == null) {
			return;
		}
		try (Stream<Path> files = Files.walk(dir)) {
			files.sorted(Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
		}
		catch (IOException ex) {
			log.warn("Could not clean up {}", dir.getFileName());
		}
	}

}
