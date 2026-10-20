package com.fullstar.api.common.jobs;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Applies one kind of worker result (by job type, e.g. "upload.scan"). Called inside the consumer's
 * app_system transaction, after processed_jobs has recorded the key, so it runs once per job.
 */
public interface JobResultHandler {

	String type();

	void apply(JobResult result, JdbcTemplate system);

}
