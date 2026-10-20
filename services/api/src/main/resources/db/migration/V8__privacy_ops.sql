-- Schema §4.7 Privacy and operations
-- Generated verbatim from docs/05-backend-schema.html; do not edit by hand (Schema §1 rule 1).

CREATE TABLE app.deletion_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid REFERENCES app.families(id) ON DELETE SET NULL,
  keycloak_user_id text NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  due_by           timestamptz NOT NULL DEFAULT now() + interval '30 days',
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  completed_by     uuid REFERENCES app.staff_users(id),
  completed_at     timestamptz
);

CREATE TABLE app.anonymous_totals (
  metric       text NOT NULL,           -- 'lessons_watched', 'worksheets_made', 'reading_tests'
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  value        bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (metric, period_month)
);

CREATE TABLE app.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type  text NOT NULL CHECK (actor_type IN ('staff','parent','system')),
  actor_id    text,
  action      text NOT NULL,            -- 'content.publish', 'upload.view', 'deletion.complete', ...
  entity_type text NOT NULL,
  entity_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_time_idx ON app.audit_log(created_at);

CREATE TABLE app.usage_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type  text NOT NULL,            -- 'book_uploaded', 'lesson_completed', 'problem_reported', ...
  class_level smallint,
  subject_id  smallint,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  props       jsonb NOT NULL DEFAULT '{}'   -- never names, emails, ids of people
);
CREATE INDEX usage_events_type_time_idx ON app.usage_events(event_type, occurred_at);

CREATE TABLE app.processed_jobs (
  idempotency_key text PRIMARY KEY,
  job_type        text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now()
);
