package com.fullstar.bookreader.pages;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.testcontainers.containers.Container;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.MountableFile;

/**
 * Plan 5.3 "done when" with the real tools: Tesseract 5.5.3 and cwebp inside the built book-reader
 * image read the committed sample pages (tools/test-pages). Runs when -Dbookreader.image=&lt;image&gt;
 * is set: make test-ocr locally, the docker workflow in CI.
 */
@EnabledIfSystemProperty(named = "bookreader.image", matches = ".+")
class RealToolsImageTest {

	private static GenericContainer<?> image;

	@BeforeAll
	static void start() {
		image = new GenericContainer<>(System.getProperty("bookreader.image"))
			.withCreateContainerCmdModifier(cmd -> cmd.withEntrypoint("sleep"))
			.withCommand("600");
		for (String page : new String[] { "english-page.png", "hindi-page.png", "blurry-photo.jpg" }) {
			image.withCopyFileToContainer(MountableFile.forClasspathResource("pages/" + page), "/tmp/" + page);
		}
		image.start();
	}

	@AfterAll
	static void stop() {
		image.stop();
	}

	private static PageTools.OcrText ocr(String page, String langs) throws Exception {
		Container.ExecResult result = image.execInContainer("tesseract", "/tmp/" + page, "stdout", "-l", langs, "--psm",
				"3", "tsv");
		assertThat(result.getExitCode()).as(result.getStderr()).isZero();
		return CommandTools.parseTsv(result.getStdout());
	}

	@Test
	void anEnglishPageIsReadable() throws Exception {
		PageTools.OcrText text = ocr("english-page.png", "eng");
		assertThat(text.text()).contains("Chapter", "Plants around us", "Leaves make food using sunlight");
		assertThat(BookProcessHandler.unclear(text)).isFalse();
		assertThat(ChapterSplitter.suggest(java.util.List.of(text.text())).get(0).title()).isEqualTo("Plants around us");
	}

	@Test
	void aHindiPageIsReadable() throws Exception {
		PageTools.OcrText text = ocr("hindi-page.png", "hin+eng");
		assertThat(text.text()).contains("मेरा गाँव", "नदी", "गीत गाती हैं");
		assertThat(BookProcessHandler.unclear(text)).isFalse();
		assertThat(ChapterSplitter.suggest(java.util.List.of(text.text())).get(0).number()).isEqualTo(1);
	}

	@Test
	void aBlurryPhotoIsUnclear() throws Exception {
		assertThat(BookProcessHandler.unclear(ocr("blurry-photo.jpg", "eng"))).isTrue();
	}

	@Test
	void cwebpWritesAWebpPage() throws Exception {
		Container.ExecResult result = image.execInContainer("sh", "-c",
				"cwebp -quiet -q 80 -resize 1200 0 /tmp/english-page.png -o /tmp/page.webp && head -c 12 /tmp/page.webp");
		assertThat(result.getExitCode()).as(result.getStderr()).isZero();
		String header = result.getStdout();
		assertThat(header.substring(0, 4)).isEqualTo("RIFF");
		assertThat(header.substring(8, 12)).isEqualTo("WEBP");
		assertThat(header.getBytes(StandardCharsets.ISO_8859_1)).hasSizeGreaterThanOrEqualTo(12);
	}

}
