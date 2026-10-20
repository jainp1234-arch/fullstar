package com.fullstar.api.common.jobs;

import java.time.Instant;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * Envelope of every queue message (Schema §12): { job_id, idempotency_key, type, version,
 * created_at, payload }.
 */
public record JobEnvelope(UUID jobId, String idempotencyKey, String type, int version, Instant createdAt,
		JsonNode payload) {

	public static final int VERSION = 1;

}
