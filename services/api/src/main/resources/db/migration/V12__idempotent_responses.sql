-- Plan 1.3 (agreed): Idempotency-Key replay stores the first response (Schema §10), scoped to its owner.
-- owner: the family id for parents, 'staff' for staff. request: 'POST /api/v1/...'.
ALTER TABLE app.processed_jobs
  ADD COLUMN owner           text,
  ADD COLUMN request         text,
  ADD COLUMN response_status smallint,
  ADD COLUMN response_body   text,             -- stored verbatim so a replay is byte-identical
  ADD CONSTRAINT processed_jobs_http_ck CHECK (job_type <> 'http' OR (owner IS NOT NULL AND request IS NOT NULL));

CREATE FUNCTION app.current_owner() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT CASE WHEN app.is_staff() THEN 'staff' ELSE app.current_family()::text END $$;

-- Replaces the V10 read/insert-all policies: app_api sees and writes only its own http records.
-- Job rows from the job-results consumer are handled by app_system (BYPASSRLS).
DROP POLICY api_read ON app.processed_jobs;
DROP POLICY api_insert ON app.processed_jobs;
CREATE POLICY http_owner ON app.processed_jobs
  USING (job_type = 'http' AND owner = app.current_owner())
  WITH CHECK (job_type = 'http' AND owner = app.current_owner());
