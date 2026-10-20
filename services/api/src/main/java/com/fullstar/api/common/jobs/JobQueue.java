package com.fullstar.api.common.jobs;

import java.time.Duration;

/** Queues of Schema §12. Each has a dead-letter queue "&lt;name&gt;-dlq"; max receives 3. */
public enum JobQueue {

	UPLOAD_SCAN("upload-scan", Duration.ofMinutes(5)),
	BOOK_PROCESS("book-process", Duration.ofMinutes(15)),
	READALONG_NARRATE("readalong-narrate", Duration.ofMinutes(30)),
	LESSON_NARRATE("lesson-narrate", Duration.ofMinutes(30)),
	READING_SCORE("reading-score", Duration.ofMinutes(5)),
	WORKSHEET_RENDER("worksheet-render", Duration.ofMinutes(2)),
	CONTENT_CHECK("content-check", Duration.ofMinutes(5)),
	JOB_RESULTS("job-results", Duration.ofMinutes(2));

	public static final int MAX_RECEIVES = 3;

	private final String baseName;

	private final Duration visibility;

	JobQueue(String baseName, Duration visibility) {
		this.baseName = baseName;
		this.visibility = visibility;
	}

	public String baseName() {
		return baseName;
	}

	public Duration visibility() {
		return visibility;
	}

	public String queueName(String prefix) {
		return prefix + baseName;
	}

	public String deadLetterName(String prefix) {
		return prefix + baseName + "-dlq";
	}

}
