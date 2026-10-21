package com.fullstar.bookreader.pages;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;

/**
 * OCR and WebP without the image's tools: a blank page reads as nothing (so it is unclear), any
 * other page as a line of readable text. The "WebP" is a marker with the source size.
 */
public class FakeTools implements PageTools.Ocr, PageTools.Webp {

	public static final String TEXT = "Look around you. Trees and grass are plants.";

	private final AtomicInteger ocrCalls = new AtomicInteger();

	public int ocrCalls() {
		return ocrCalls.get();
	}

	@Override
	public PageTools.OcrText read(Path image, String langs) {
		ocrCalls.incrementAndGet();
		return blank(image) ? new PageTools.OcrText("", 0) : new PageTools.OcrText(TEXT + " (" + langs + ")", 91.5);
	}

	@Override
	public byte[] encode(Path image, int maxWidth) {
		return ("RIFF-fake-WEBP-" + image.getFileName()).getBytes(StandardCharsets.US_ASCII);
	}

	private static boolean blank(Path image) {
		try {
			BufferedImage picture = ImageIO.read(image.toFile());
			for (int y = 0; y < picture.getHeight(); y += 4) {
				for (int x = 0; x < picture.getWidth(); x += 4) {
					if ((picture.getRGB(x, y) & 0xFF) < 200) {
						return false;
					}
				}
			}
			return true;
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

}
