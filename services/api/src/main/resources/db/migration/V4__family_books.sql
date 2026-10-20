-- Schema §4.3 Family books and uploads
-- Generated verbatim from docs/05-backend-schema.html; do not edit by hand (Schema §1 rule 1).

CREATE TABLE app.family_books (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  subject_id         smallint NOT NULL REFERENCES app.subjects(id),
  class_level        smallint NOT NULL CHECK (class_level BETWEEN 1 AND 5),
  catalog_book_id    uuid REFERENCES app.catalog_books(id),
  upload_mode        text NOT NULL CHECK (upload_mode IN ('whole','chapterwise')),
  status             text NOT NULL DEFAULT 'getting_ready' CHECK (status IN
                       ('getting_ready','needs_attention','readalong_ready','lessons_being_prepared','lessons_ready')),
  split_confirmed_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX family_books_family_idx ON app.family_books(family_id);

-- One book per subject per child; a book can be shared with a sibling
CREATE TABLE app.child_books (
  child_id       uuid NOT NULL REFERENCES app.children(id) ON DELETE CASCADE,
  subject_id     smallint NOT NULL REFERENCES app.subjects(id),
  family_book_id uuid NOT NULL REFERENCES app.family_books(id) ON DELETE CASCADE,
  family_id      uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, subject_id)
);

CREATE TABLE app.family_chapters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_book_id     uuid NOT NULL REFERENCES app.family_books(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  number             smallint NOT NULL CHECK (number > 0),
  title              varchar(200) NOT NULL,
  catalog_chapter_id uuid REFERENCES app.catalog_chapters(id),
  status             text NOT NULL DEFAULT 'processing' CHECK (status IN
                       ('suggested','processing','needs_attention','readalong_ready','lessons_being_prepared','lessons_ready')),
  page_count         smallint NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 300),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_chapter_number_uq UNIQUE (family_book_id, number) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX family_chapters_catalog_idx ON app.family_chapters(catalog_chapter_id);

CREATE TABLE app.uploads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  family_book_id    uuid NOT NULL REFERENCES app.family_books(id) ON DELETE CASCADE,
  family_chapter_id uuid REFERENCES app.family_chapters(id) ON DELETE CASCADE,  -- NULL for a whole book
  source            text NOT NULL CHECK (source IN ('pdf','photos')),
  status            text NOT NULL DEFAULT 'awaiting_files' CHECK (status IN
                      ('awaiting_files','scanning','rejected','processing','processed','failed')),
  file_count        smallint NOT NULL CHECK (file_count BETWEEN 1 AND 50),
  reject_reason     text CHECK (reject_reason IN ('infected','wrong_type','too_large','too_many_pages','unreadable')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upload_pdf_single CHECK (source <> 'pdf' OR file_count = 1)
);

CREATE TABLE app.upload_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id    uuid NOT NULL REFERENCES app.uploads(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  object_key   text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size    bigint NOT NULL CHECK (
                 (content_type = 'application/pdf' AND byte_size BETWEEN 1 AND 52428800) OR
                 (content_type <> 'application/pdf' AND byte_size BETWEEN 1 AND 10485760)),
  scan_status  text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.pages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_chapter_id   uuid NOT NULL REFERENCES app.family_chapters(id) ON DELETE CASCADE,
  family_id           uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  upload_file_id      uuid NOT NULL REFERENCES app.upload_files(id) ON DELETE CASCADE,
  page_no             smallint NOT NULL CHECK (page_no > 0),
  image_key           text NOT NULL,
  ocr_text            text,
  ocr_confidence      numeric(5,2) CHECK (ocr_confidence BETWEEN 0 AND 100),
  quality             text NOT NULL DEFAULT 'ok' CHECK (quality IN ('ok','unclear','retaken')),
  narration_audio_key text,
  word_timings        jsonb,          -- [{"w":"bird","start_ms":1200,"end_ms":1480}, ...]
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_chapter_id, page_no)
);

CREATE TABLE app.prep_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_chapter_id  uuid NOT NULL REFERENCES app.family_chapters(id) ON DELETE CASCADE,
  catalog_chapter_id uuid REFERENCES app.catalog_chapters(id),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  assigned_to        uuid REFERENCES app.staff_users(id),
  opened_at          timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz
);
CREATE UNIQUE INDEX prep_tasks_one_active ON app.prep_tasks(family_chapter_id) WHERE status IN ('open','in_progress');
CREATE INDEX prep_tasks_queue_idx ON app.prep_tasks(status, opened_at);

CREATE TABLE app.lesson_previews (
  family_id       uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES app.content_items(id) ON DELETE CASCADE,
  result          text NOT NULL CHECK (result IN ('looks_good','reported')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, content_item_id)
);
