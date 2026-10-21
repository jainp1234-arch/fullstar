package com.fullstar.bookreader.jobs;

import tools.jackson.databind.JsonNode;

/**
 * One kind of job book-reader does (Schema §12). handle returns the result payload; throwing means
 * "try again" (the message stays on its queue; the last try reports a failure).
 */
public interface JobHandler {

	/** Queue base name, e.g. "upload-scan". */
	String queue();

	/** Job type in the envelope, e.g. "upload.scan". */
	String type();

	JsonNode handle(JobEnvelope job);

}
