-- Schema §4.5 Worksheets
-- Generated verbatim from docs/05-backend-schema.html; do not edit by hand (Schema §1 rule 1).

CREATE TABLE app.worksheets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  child_id          uuid NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
  subject_id        smallint NOT NULL REFERENCES app.subjects(id),
  source            text NOT NULL CHECK (source IN ('chapter','topic')),
  family_chapter_id uuid REFERENCES app.family_chapters(id) ON DELETE CASCADE,
  topic_id          uuid REFERENCES app.topics(id),
  question_count    smallint NOT NULL CHECK (question_count BETWEEN 5 AND 30),
  shuffle_seed      bigint NOT NULL,
  status            text NOT NULL DEFAULT 'rendering' CHECK (status IN ('rendering','ready','failed')),
  pdf_key           text,
  pdf_expires_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worksheet_source_ck CHECK (
    (source = 'chapter' AND family_chapter_id IS NOT NULL AND topic_id IS NULL) OR
    (source = 'topic'   AND topic_id IS NOT NULL AND family_chapter_id IS NULL))
);
CREATE INDEX worksheets_child_idx ON app.worksheets(child_id, created_at DESC);

CREATE TABLE app.worksheet_questions (
  worksheet_id        uuid NOT NULL REFERENCES app.worksheets(id) ON DELETE CASCADE,
  position            smallint NOT NULL CHECK (position > 0),
  question_item_id    uuid NOT NULL REFERENCES app.content_items(id),
  question_version_id uuid NOT NULL REFERENCES app.content_versions(id),
  PRIMARY KEY (worksheet_id, position)
);

CREATE TABLE app.worksheet_weak_spots (
  worksheet_id uuid NOT NULL REFERENCES app.worksheets(id) ON DELETE CASCADE,
  topic_id     uuid NOT NULL REFERENCES app.topics(id),
  family_id    uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  child_id     uuid NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
  marked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (worksheet_id, topic_id)
);
