package com.fullstar.bookreader.pages;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Suggests the chapters of a whole book from its page text (Plan 5.3, App Flow P6): a page that
 * starts with a heading like "Chapter 3", "Lesson 3", "Unit 3", "पाठ ३" or "अध्याय 3" starts a
 * chapter; titles come from the heading line, the line after it, or a contents page with the same
 * number. Without any heading the whole book is one chapter. The parent checks the split in P6.
 */
public final class ChapterSplitter {

	/** How many lines at the top of a page may hold the heading. */
	private static final int HEAD_LINES = 4;

	private static final Pattern HEADING = Pattern.compile(
			"^\\s*(?:chapter|lesson|unit|पाठ|अध्याय|इकाई)\\s*[-:.]?\\s*(\\d{1,2})\\b[\\s:.\\-–]*(.*)$",
			Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

	/** The heading word alone, its number lost by OCR (a thin "1" often reads as nothing, "|" or "।"). */
	private static final Pattern BARE_HEADING = Pattern.compile(
			"^\\s*(?:chapter|lesson|unit|पाठ|अध्याय|इकाई)\\s*[|।lIi!.:]?\\s*$",
			Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

	private static final Pattern CONTENTS_TITLE = Pattern.compile(
			"^\\s*(contents|table of contents|विषय[- ]?सूची|अनुक्रमणिका|सूची)\\s*$",
			Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

	/** "3. Water ........ 21" or "3 Water 21" on a contents page. */
	private static final Pattern CONTENTS_ROW = Pattern.compile("^\\s*(\\d{1,2})[.)]?\\s+(.+?)[\\s.·…_-]*(\\d{1,3})\\s*$");

	private static final int TITLE_MAX = 200;

	private ChapterSplitter() {
	}

	/** start_page is the 1-based page of the whole upload where the chapter begins. */
	public record Suggestion(int number, String title, int startPage) {
	}

	public static List<Suggestion> suggest(List<String> pageTexts) {
		Map<Integer, String> contents = new HashMap<>();
		List<Suggestion> found = new ArrayList<>();
		for (int i = 0; i < pageTexts.size(); i++) {
			List<String> lines = nonEmptyLines(normalizeDigits(pageTexts.get(i)));
			if (isContentsPage(lines)) {
				readContents(lines, contents);
				continue;
			}
			for (int l = 0; l < Math.min(HEAD_LINES, lines.size()); l++) {
				Matcher heading = HEADING.matcher(lines.get(l));
				boolean numbered = heading.matches();
				if (!numbered && !BARE_HEADING.matcher(lines.get(l)).matches()) {
					continue;
				}
				// Without a readable number the chapter takes the next one
				int number = numbered ? Integer.parseInt(heading.group(1)) : found.size() + 1;
				if (number == 0 || found.stream().anyMatch(s -> s.number() == number)) {
					break;
				}
				String title = numbered ? heading.group(2).strip() : "";
				if (title.isEmpty() && l + 1 < lines.size()) {
					title = lines.get(l + 1).strip();
				}
				found.add(new Suggestion(number, title, i + 1));
				break;
			}
		}
		if (found.isEmpty()) {
			return List.of(new Suggestion(1, "Chapter 1", 1));
		}
		List<Suggestion> chapters = new ArrayList<>();
		for (int i = 0; i < found.size(); i++) {
			Suggestion s = found.get(i);
			// The first chapter also takes the pages before it (cover, contents)
			int start = i == 0 ? 1 : s.startPage();
			String title = contents.getOrDefault(s.number(), s.title());
			chapters.add(new Suggestion(s.number(), clip(title.isBlank() ? "Chapter " + s.number() : title), start));
		}
		return chapters;
	}

	/** Devanagari digits ०–९ as 0–9, so "पाठ ३" reads as chapter 3. */
	static String normalizeDigits(String text) {
		StringBuilder out = new StringBuilder(text.length());
		text.codePoints().forEach(cp -> out.appendCodePoint(cp >= 0x0966 && cp <= 0x096F ? '0' + (cp - 0x0966) : cp));
		return out.toString();
	}

	private static boolean isContentsPage(List<String> lines) {
		return lines.stream().limit(HEAD_LINES).anyMatch(line -> CONTENTS_TITLE.matcher(line).matches());
	}

	private static void readContents(List<String> lines, Map<Integer, String> contents) {
		for (String line : lines) {
			Matcher row = CONTENTS_ROW.matcher(line);
			if (row.matches()) {
				contents.putIfAbsent(Integer.parseInt(row.group(1)), row.group(2).strip());
			}
		}
	}

	private static List<String> nonEmptyLines(String text) {
		return text.lines().map(String::strip).filter(line -> !line.isEmpty()).toList();
	}

	private static String clip(String title) {
		return title.length() <= TITLE_MAX ? title : title.substring(0, TITLE_MAX).strip();
	}

}
