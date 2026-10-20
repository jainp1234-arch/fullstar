package com.fullstar.api.common.jobs;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * Payload of a job-results message (Schema §12): { job_id, idempotency_key, type, outcome:
 * success | failure, result | error }. idempotency_key is the original job's key.
 */
public record JobResult(UUID jobId, String idempotencyKey, String type, String outcome, JsonNode result,
		JsonNode error) {

	public boolean succeeded() {
		return "success".equals(outcome);
	}

}
