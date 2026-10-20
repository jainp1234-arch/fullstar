-- Schema §4.2 Content library and content check
-- Generated verbatim from docs/05-backend-schema.html; do not edit by hand (Schema §1 rule 1).

CREATE TABLE app.topics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_level smallint NOT NULL CHECK (class_level BETWEEN 1 AND 5),
  subject_id  smallint NOT NULL REFERENCES app.subjects(id),
  parent_id   uuid REFERENCES app.topics(id) ON DELETE RESTRICT,
  name        varchar(120) NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_by  uuid REFERENCES app.staff_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (class_level, subject_id, parent_id, name)
);

CREATE TABLE app.catalog_books (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_level smallint NOT NULL CHECK (class_level BETWEEN 1 AND 5),
  subject_id  smallint NOT NULL REFERENCES app.subjects(id),
  title       varchar(200) NOT NULL,
  board       text NOT NULL DEFAULT 'CBSE' CHECK (board IN ('CBSE','ICSE','STATE','OTHER')),
  publisher   varchar(120),
  edition     varchar(40),
  created_by  uuid REFERENCES app.staff_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.catalog_chapters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_book_id uuid NOT NULL REFERENCES app.catalog_books(id) ON DELETE RESTRICT,
  number          smallint NOT NULL CHECK (number > 0),
  title           varchar(200) NOT NULL,
  status          text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','ready')),
  ready_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_book_id, number)
);

CREATE TABLE app.content_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind IN ('lesson','question','passage')),
  scope                text NOT NULL CHECK (scope IN ('library','catalog_chapter')),
  class_level          smallint NOT NULL CHECK (class_level BETWEEN 1 AND 5),
  subject_id           smallint NOT NULL REFERENCES app.subjects(id),
  topic_id             uuid REFERENCES app.topics(id),
  catalog_chapter_id   uuid REFERENCES app.catalog_chapters(id) ON DELETE RESTRICT,
  question_type        text CHECK (question_type IN ('mcq','true_false','fill_blank','match')),
  difficulty           smallint NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  lang                 text NOT NULL CHECK (lang IN ('en','hi')),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_check','published','archived')),
  current_version_id   uuid,
  published_version_id uuid,
  published_at         timestamptz,
  created_by           uuid NOT NULL REFERENCES app.staff_users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz,
  CONSTRAINT content_scope_ck CHECK (
    (scope = 'library' AND catalog_chapter_id IS NULL AND topic_id IS NOT NULL) OR
    (scope = 'catalog_chapter' AND catalog_chapter_id IS NOT NULL)),
  CONSTRAINT content_qtype_ck CHECK ((kind = 'question') = (question_type IS NOT NULL)),
  CONSTRAINT content_passage_ck CHECK (kind <> 'passage' OR scope = 'library')
);
CREATE INDEX content_items_lookup_idx  ON app.content_items(kind, status, class_level, subject_id, topic_id);
CREATE INDEX content_items_chapter_idx ON app.content_items(catalog_chapter_id, kind, status);

CREATE TABLE app.content_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             uuid NOT NULL REFERENCES app.content_items(id) ON DELETE CASCADE,
  version_no          integer NOT NULL,
  title               varchar(200) NOT NULL,
  body                jsonb NOT NULL,                 -- format per kind: section 5
  solution            jsonb,                          -- questions only
  asset_keys          text[] NOT NULL DEFAULT '{}',   -- R2 keys of images used
  narration_audio_key text,                           -- lessons: generated narration
  duration_seconds    integer CHECK (duration_seconds >= 0),
  created_by          uuid NOT NULL REFERENCES app.staff_users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version_no)
);
ALTER TABLE app.content_items
  ADD CONSTRAINT content_current_fk   FOREIGN KEY (current_version_id)   REFERENCES app.content_versions(id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT content_published_fk FOREIGN KEY (published_version_id) REFERENCES app.content_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE app.content_checks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id     uuid NOT NULL REFERENCES app.content_versions(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','error')),
  model          text NOT NULL,
  critical_count integer NOT NULL DEFAULT 0,
  warning_count  integer NOT NULL DEFAULT 0,
  error_message  text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX content_checks_version_idx ON app.content_checks(version_id, started_at DESC);

CREATE TABLE app.content_check_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id        uuid NOT NULL REFERENCES app.content_checks(id) ON DELETE CASCADE,
  severity        text NOT NULL CHECK (severity IN ('critical','warning')),
  category        text NOT NULL CHECK (category IN ('age_suitability','fact_mismatch','wrong_answer',
                                                   'language','difficulty','bias','personal_info','other')),
  location        jsonb NOT NULL,                 -- {"path": "scenes[2].text"} or {"field": "solution"}
  reason          text NOT NULL,
  resolution      text NOT NULL DEFAULT 'open' CHECK (resolution IN ('open','fixed','accepted')),
  resolution_note varchar(500),
  resolved_by     uuid REFERENCES app.staff_users(id),
  resolved_at     timestamptz,
  CONSTRAINT flag_accept_warning_only CHECK (resolution <> 'accepted' OR severity = 'warning'),
  CONSTRAINT flag_accept_needs_note   CHECK (resolution <> 'accepted' OR resolution_note IS NOT NULL)
);
