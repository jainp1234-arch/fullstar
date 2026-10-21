package com.fullstar.bookreader.jobs;

import java.time.Instant;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * Envelope of every queue message (Schema §12): { job_id, idempotency_key, type, version,
 * created_at, payload }. The same record as in services/api.
 */
public record JobEnvelope(UUID jobId, String idempotencyKey, String type, int version, Instant createdAt,
		JsonNode payload) {

	public static final int VERSION = 1;

	/** Type of the messages workers send to job-results. */
	public static final String RESULT_TYPE = "job.result";

}
