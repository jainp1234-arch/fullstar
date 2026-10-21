package com.fullstar.bookreader.pages;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Component;

/**
 * Runs tesseract and cwebp from the image's PATH, each with a time limit. Tesseract writes TSV, so
 * the text keeps its lines and each word's confidence is known.
 */
@Component
public class CommandTools implements PageTools.Ocr, PageTools.Webp {

	private static final Duration OCR_LIMIT = Duration.ofSeconds(120);

	private static final Duration WEBP_LIMIT = Duration.ofSeconds(60);

	private static final ExecutorService READERS = Executors.newVirtualThreadPerTaskExecutor();

	@Override
	public PageTools.OcrText read(Path image, String langs) {
		String tsv = new String(run(List.of("tesseract", image.toString(), "stdout", "-l", langs, "--psm", "3", "tsv"),
				OCR_LIMIT), StandardCharsets.UTF_8);
		return parseTsv(tsv);
	}

	@Override
	public byte[] encode(Path image, int maxWidth) {
		try {
			Path out = Files.createTempFile(image.getParent(), "page-", ".webp");
			run(List.of("cwebp", "-quiet", "-q", "80", "-resize", String.valueOf(maxWidth), "0", image.toString(),
					"-o", out.toString()), WEBP_LIMIT);
			byte[] webp = Files.readAllBytes(out);
			Files.deleteIfExists(out);
			return webp;
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	/**
	 * Tesseract TSV: level page block par line word left top width height conf text. Words (level 5)
	 * are joined into their lines; confidence is the mean over words weighted by their length.
	 */
	static PageTools.OcrText parseTsv(String tsv) {
		Map<String, List<String>> lines = new LinkedHashMap<>();
		double weighted = 0;
		int letters = 0;
		for (String row : tsv.split("\\R")) {
			String[] cells = row.split("\t", -1);
			if (cells.length < 12 || !"5".equals(cells[0])) {
				continue;
			}
			String word = cells[11].strip();
			double conf;
			try {
				conf = Double.parseDouble(cells[10]);
			}
			catch (NumberFormatException ex) {
				continue;
			}
			if (word.isEmpty() || conf < 0) {
				continue;
			}
			lines.computeIfAbsent(cells[2] + "." + cells[3] + "." + cells[4], k -> new ArrayList<>()).add(word);
			weighted += conf * word.length();
			letters += word.length();
		}
		String text = String.join("\n", lines.values().stream().map(words -> String.join(" ", words)).toList());
		return new PageTools.OcrText(text, letters == 0 ? 0 : weighted / letters);
	}

	private static byte[] run(List<String> command, Duration limit) {
		try {
			Process process = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD).start();
			// Read on another thread, so the time limit holds even if the tool stops writing
			CompletableFuture<byte[]> out = CompletableFuture.supplyAsync(() -> {
				try {
					return process.getInputStream().readAllBytes();
				}
				catch (IOException ex) {
					throw new UncheckedIOException(ex);
				}
			}, READERS);
			if (!process.waitFor(limit.toSeconds(), TimeUnit.SECONDS)) {
				process.destroyForcibly();
				throw new IllegalStateException(command.get(0) + " took too long");
			}
			if (process.exitValue() != 0) {
				throw new IllegalStateException(command.get(0) + " failed with exit code " + process.exitValue());
			}
			return out.get(10, TimeUnit.SECONDS);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(command.get(0) + " could not run", ex);
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException(command.get(0) + " was interrupted", ex);
		}
		catch (ExecutionException | TimeoutException ex) {
			throw new IllegalStateException(command.get(0) + " output could not be read", ex);
		}
	}

}
