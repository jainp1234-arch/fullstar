-- Schema §4.4 Progress
-- Generated verbatim from docs/05-backend-schema.html; do not edit by hand (Schema §1 rule 1).

CREATE TABLE app.activity_attempts (
  id                 uuid PRIMARY KEY,                -- generated on the device
  family_id          uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  child_id           uuid NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('lesson','practice','worksheet','tables',
                                                   'tables_challenge','reading_test','readalong')),
  subject_id         smallint NOT NULL REFERENCES app.subjects(id),
  content_item_id    uuid REFERENCES app.content_items(id),
  content_version_id uuid REFERENCES app.content_versions(id),
  family_chapter_id  uuid REFERENCES app.family_chapters(id) ON DELETE SET NULL,
  topic_id           uuid REFERENCES app.topics(id),
  started_at         timestamptz NOT NULL,
  completed_at       timestamptz,
  correct_count      smallint CHECK (correct_count >= 0),
  total_count        smallint CHECK (total_count >= 0),
  stars              smallint NOT NULL DEFAULT 0 CHECK (stars BETWEEN 0 AND 3),
  duration_seconds   integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  resume_state       jsonb,                           -- {"position_s": 362} or {"question_index": 4}
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attempt_counts_ck CHECK (correct_count IS NULL OR total_count IS NULL OR correct_count <= total_count)
);
CREATE INDEX attempts_child_time_idx ON app.activity_attempts(child_id, started_at DESC);
CREATE INDEX attempts_open_idx ON app.activity_attempts(child_id) WHERE completed_at IS NULL;

CREATE TABLE app.answer_events (
  id                  uuid PRIMARY KEY,               -- generated on the device
  attempt_id          uuid NOT NULL REFERENCES app.activity_attempts(id) ON DELETE CASCADE,
  family_id           uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  child_id            uuid NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
  question_item_id    uuid NOT NULL REFERENCES app.content_items(id),
  question_version_id uuid NOT NULL REFERENCES app.content_versions(id),
  topic_id            uuid REFERENCES app.topics(id),
  is_correct          boolean NOT NULL,
  answer              jsonb NOT NULL,
  answered_at         timestamptz NOT NULL
);
CREATE INDEX answers_child_topic_idx ON app.answer_events(child_id, topic_id, answered_at DESC);

CREATE TABLE app.mistakes (
  child_id         uuid NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
  question_item_id uuid NOT NULL REFERENCES app.content_items(id) ON DELETE CASCADE,
  family_id        uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  topic_id         uuid REFERENCES app.topics(id),
  wrong_count      integer NOT NULL DEFAULT 1,
  correct_streak   smallint NOT NULL DEFAULT 0,
  last_wrong_at    timestamptz NOT NULL,
  resolved_at      timestamptz,
  PRIMARY KEY (child_id, question_item_id)
);
CREATE INDEX mistakes_open_idx ON app.mistakes(child_id) WHERE resolved_at IS NULL;

CREATE TABLE app.usage_minutes (
  child_id  uuid NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
  minute_at timestamptz NOT NULL CHECK (date_trunc('minute', minute_at) = minute_at),
  family_id uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  PRIMARY KEY (child_id, minute_at)
);

CREATE TABLE app.reading_tests (
  id                   uuid PRIMARY KEY,              -- generated on the device
  attempt_id           uuid NOT NULL UNIQUE REFERENCES app.activity_attempts(id) ON DELETE CASCADE,
  family_id            uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  child_id             uuid NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
  passage_item_id      uuid NOT NULL REFERENCES app.content_items(id),
  passage_version_id   uuid NOT NULL REFERENCES app.content_versions(id),
  test_date            date NOT NULL,                 -- India date
  recording_key        text,
  recording_expires_at timestamptz,
  status               text NOT NULL DEFAULT 'awaiting_audio' CHECK (status IN
                         ('awaiting_audio','processing','scored','not_understood','failed')),
  transcript           text,
  accuracy_pct         numeric(5,2) CHECK (accuracy_pct BETWEEN 0 AND 100),
  words_per_minute     numeric(6,2) CHECK (words_per_minute >= 0),
  words_to_practise    text[] NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reading_tests_child_date_idx ON app.reading_tests(child_id, test_date);
