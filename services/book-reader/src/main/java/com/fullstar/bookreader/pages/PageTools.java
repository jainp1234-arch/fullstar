package com.fullstar.bookreader.pages;

import java.nio.file.Path;

/**
 * The two command-line tools of the book-reader image (Tech Stack §7; Plan 5.3): Tesseract 5.5.3 for
 * text and cwebp for the stored page image. Interfaces so the unit tests can use fakes; the real
 * tools are tested in the built image.
 */
public final class PageTools {

	private PageTools() {
	}

	/** Text of one page image and Tesseract's mean word confidence (0–100; 0 when no words). */
	public record OcrText(String text, double confidence) {
	}

	public interface Ocr {

		/** langs as Tesseract takes them, e.g. "eng" or "hin+eng". */
		OcrText read(Path image, String langs);

	}

	public interface Webp {

		/** The page as WebP, at most maxWidth pixels wide. */
		byte[] encode(Path image, int maxWidth);

	}

}
