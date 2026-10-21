package com.fullstar.bookreader.pages;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class ChapterSplitterTest {

	@Test
	void headingsStartChaptersAndTheFirstTakesTheFrontPages() {
		List<ChapterSplitter.Suggestion> chapters = ChapterSplitter.suggest(List.of(
				"My EVS Book\nClass 3", "Chapter 1\nPlants around us\nLook around you.", "Roots grow under the soil.",
				"Lesson 2: Animals and their homes\nA bird builds a nest.", "UNIT 3 - Water\nWe need water."));
		assertThat(chapters).containsExactly(new ChapterSplitter.Suggestion(1, "Plants around us", 1),
				new ChapterSplitter.Suggestion(2, "Animals and their homes", 4),
				new ChapterSplitter.Suggestion(3, "Water", 5));
	}

	@Test
	void hindiHeadingsWithDevanagariDigitsAndContentsTitles() {
		List<ChapterSplitter.Suggestion> chapters = ChapterSplitter.suggest(List.of(
				"विषय-सूची\n1. मेरा गाँव ........ 3\n2. प्यासा कौआ ........ 9",
				"पाठ १\nगाँव\nमेरा गाँव बहुत सुंदर है।", "नदी के किनारे पेड़ हैं।", "पाठ २\nएक कौआ प्यासा था।"));
		assertThat(chapters).containsExactly(new ChapterSplitter.Suggestion(1, "मेरा गाँव", 1),
				new ChapterSplitter.Suggestion(2, "प्यासा कौआ", 4));
	}

	@Test
	void withoutHeadingsTheBookIsOneChapterAndRepeatsAreIgnored() {
		assertThat(ChapterSplitter.suggest(List.of("Some text.", "More text.")))
			.containsExactly(new ChapterSplitter.Suggestion(1, "Chapter 1", 1));
		List<ChapterSplitter.Suggestion> repeated = ChapterSplitter
			.suggest(List.of("Chapter 1 Plants", "Chapter 1 Plants (continued)", "Chapter 2 Water"));
		assertThat(repeated).extracting(ChapterSplitter.Suggestion::startPage).containsExactly(1, 3);
		assertThat(ChapterSplitter.normalizeDigits("पाठ १२")).isEqualTo("पाठ 12");
	}

	@Test
	void aHeadingWhoseNumberOcrLostTakesTheNextNumber() {
		// What Tesseract made of "Chapter 1" and "पाठ 1" set in Poppins (tools/test-pages)
		List<ChapterSplitter.Suggestion> chapters = ChapterSplitter
			.suggest(List.of("Chapter\n\nPlants around us\nLook around you.", "पाठ ।\nमेरा गाँव\nमेरा गाँव बहुत सुंदर है।"));
		assertThat(chapters).containsExactly(new ChapterSplitter.Suggestion(1, "Plants around us", 1),
				new ChapterSplitter.Suggestion(2, "मेरा गाँव", 2));
	}

	@Test
	void tesseractTsvBecomesLinesAndAWeightedConfidence() {
		String tsv = """
				level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
				1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t
				5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t96.0\tChapter
				5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t90.0\t1
				5\t1\t1\t1\t2\t1\t0\t0\t10\t10\t40.0\tPlants
				5\t1\t1\t1\t2\t2\t0\t0\t10\t10\t-1\t
				""";
		PageTools.OcrText text = CommandTools.parseTsv(tsv);
		assertThat(text.text()).isEqualTo("Chapter 1\nPlants");
		assertThat(text.confidence()).isCloseTo((96.0 * 7 + 90.0 + 40.0 * 6) / 14, org.assertj.core.data.Offset.offset(0.01));
		assertThat(CommandTools.parseTsv("").confidence()).isZero();
		assertThat(BookProcessHandler.unclear(new PageTools.OcrText("Too short", 95))).isTrue();
		assertThat(BookProcessHandler.unclear(new PageTools.OcrText("A long enough line of words here", 55))).isTrue();
		assertThat(BookProcessHandler.unclear(new PageTools.OcrText("A long enough line of words here", 75))).isFalse();
	}

}
