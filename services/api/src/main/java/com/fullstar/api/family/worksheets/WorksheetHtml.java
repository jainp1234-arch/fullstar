package com.fullstar.api.family.worksheets;

import java.util.List;
import tools.jackson.databind.JsonNode;

/**
 * The printable worksheet (App Flow P12; Plan 7.2): an A4 question paper with name and date lines,
 * then the answer key on a new page. Hindi uses the bundled Noto Sans Devanagari, so conjuncts are
 * shaped by Chromium's text engine. Every text from content is HTML-escaped.
 */
final class WorksheetHtml {

	static final String FONT_FILE = "NotoSansDevanagari.ttf";

	private static final String LETTERS = "ABCD";

	private WorksheetHtml() {
	}

	record Question(int position, String type, JsonNode body, JsonNode solution) {
	}

	static String render(String heading, String lang, List<Question> questions) {
		StringBuilder html = new StringBuilder("""
				<!doctype html>
				<html lang="%s"><head><meta charset="utf-8"><title>%s</title>
				<style>
				  @font-face { font-family: "Noto Sans Devanagari"; src: url("%s"); }
				  body { font-family: "Noto Sans Devanagari", sans-serif; font-size: 13pt; line-height: 1.6; color: #1d1b2c; }
				  h1 { font-size: 17pt; margin: 0 0 4pt; }
				  .lines { display: flex; gap: 24pt; margin: 8pt 0 16pt; }
				  .lines span { flex: 1; border-bottom: 1px solid #888; padding-bottom: 2pt; }
				  ol.questions { padding-left: 18pt; }
				  ol.questions > li { margin: 0 0 14pt; break-inside: avoid; }
				  .options { list-style: none; padding: 0; margin: 4pt 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2pt 16pt; }
				  .match { display: grid; grid-template-columns: 1fr 1fr; gap: 2pt 32pt; margin-top: 4pt; }
				  .answer-line { display: inline-block; min-width: 120pt; border-bottom: 1px solid #888; }
				  .key { break-before: page; }
				  .key li { margin: 0 0 6pt; }
				  .why { color: #555; font-size: 11pt; }
				</style></head><body>
				<h1>%s</h1>
				<div class="lines"><span>Name:</span><span>Date:</span></div>
				<ol class="questions">
				""".formatted(lang, escape(heading), FONT_FILE, escape(heading)));
		for (Question q : questions) {
			html.append("<li>").append(escape(q.body().path("prompt").asString(""))).append(question(q)).append("</li>\n");
		}
		html.append("</ol>\n<section class=\"key\"><h1>Answer key</h1><ol>\n");
		for (Question q : questions) {
			html.append("<li><strong>").append(escape(answer(q))).append("</strong>");
			String why = q.solution() == null ? "" : q.solution().path("explanation").asString("");
			if (!why.isBlank()) {
				html.append(" <span class=\"why\">").append(escape(why)).append("</span>");
			}
			html.append("</li>\n");
		}
		return html.append("</ol></section></body></html>\n").toString();
	}

	private static String question(Question q) {
		StringBuilder out = new StringBuilder();
		switch (q.type()) {
			case "mcq" -> {
				out.append("<ul class=\"options\">");
				int i = 0;
				for (JsonNode option : q.body().path("options")) {
					out.append("<li>").append(LETTERS.charAt(i++)).append(") ")
						.append(escape(option.path("text").asString(""))).append("</li>");
				}
				out.append("</ul>");
			}
			case "true_false" -> out.append("<ul class=\"options\"><li>A) True</li><li>B) False</li></ul>");
			case "fill_blank" -> {
				out.append("<ul class=\"options\">");
				int i = 0;
				for (JsonNode choice : q.body().path("choices")) {
					out.append("<li>").append(LETTERS.charAt(i++)).append(") ").append(escape(choice.asString(""))).append("</li>");
				}
				out.append("</ul>");
			}
			case "match" -> {
				out.append("<div class=\"match\">");
				JsonNode left = q.body().path("left");
				JsonNode right = q.body().path("right");
				for (int i = 0; i < Math.max(left.size(), right.size()); i++) {
					out.append("<span>").append(i + 1).append(". ").append(escape(left.path(i).path("text").asString("")))
						.append("</span><span>").append((char) ('a' + i)).append(") ")
						.append(escape(right.path(i).path("text").asString(""))).append("</span>");
				}
				out.append("</div>");
			}
			default -> out.append(" <span class=\"answer-line\"></span>");
		}
		return out.toString();
	}

	/** The right answer as the key prints it. */
	static String answer(Question q) {
		JsonNode s = q.solution();
		if (s == null) {
			return "";
		}
		switch (q.type()) {
			case "mcq" -> {
				String id = s.path("correct").path(0).asString("");
				int i = 0;
				for (JsonNode option : q.body().path("options")) {
					if (option.path("id").asString("").equals(id)) {
						return LETTERS.charAt(i) + ") " + option.path("text").asString("");
					}
					i++;
				}
				return "";
			}
			case "true_false" -> {
				return s.path("correct").asBoolean() ? "True" : "False";
			}
			case "fill_blank" -> {
				return s.path("correct").asString("");
			}
			case "match" -> {
				StringBuilder pairs = new StringBuilder();
				JsonNode left = q.body().path("left");
				JsonNode right = q.body().path("right");
				for (JsonNode pair : s.path("pairs")) {
					int l = indexOf(left, pair.path(0).asString(""));
					int r = indexOf(right, pair.path(1).asString(""));
					pairs.append(pairs.isEmpty() ? "" : ", ").append(l + 1).append("–").append((char) ('a' + r));
				}
				return pairs.toString();
			}
			default -> {
				return "";
			}
		}
	}

	private static int indexOf(JsonNode items, String id) {
		for (int i = 0; i < items.size(); i++) {
			if (items.path(i).path("id").asString("").equals(id)) {
				return i;
			}
		}
		return -1;
	}

	static String escape(String text) {
		StringBuilder out = new StringBuilder(text.length());
		for (char c : text.toCharArray()) {
			switch (c) {
				case '<' -> out.append("&lt;");
				case '>' -> out.append("&gt;");
				case '&' -> out.append("&amp;");
				case '"' -> out.append("&quot;");
				case '\'' -> out.append("&#39;");
				default -> out.append(c);
			}
		}
		return out.toString();
	}

}
