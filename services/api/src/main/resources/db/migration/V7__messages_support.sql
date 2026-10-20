-- Schema §4.6 Messages and support
-- Generated verbatim from docs/05-backend-schema.html; do not edit by hand (Schema §1 rule 1).

CREATE TABLE app.messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('readalong_ready','pages_unclear','lessons_ready','upload_problem',
                                          'report_fixed','support_reply','system')),
  title      varchar(120) NOT NULL,
  body       varchar(500) NOT NULL,
  link       jsonb,                      -- {"screen":"P8","family_chapter_id":"..."}
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days'
);
CREATE INDEX messages_family_idx ON app.messages(family_id, created_at DESC);

CREATE TABLE app.problem_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  content_item_id    uuid NOT NULL REFERENCES app.content_items(id),
  content_version_id uuid NOT NULL REFERENCES app.content_versions(id),
  reason             text NOT NULL CHECK (reason IN ('wrong_answer','spelling','not_suitable','audio_problem','other')),
  note               varchar(500),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','dismissed')),
  handled_by         uuid REFERENCES app.staff_users(id),
  handled_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX problem_reports_open_idx ON app.problem_reports(status, created_at);

CREATE TABLE app.support_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  subject    varchar(120) NOT NULL,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.support_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES app.support_tickets(id) ON DELETE CASCADE,
  family_id  uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  author     text NOT NULL CHECK (author IN ('parent','staff')),
  staff_id   uuid REFERENCES app.staff_users(id),
  body       varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_author_ck CHECK ((author = 'staff') = (staff_id IS NOT NULL))
);
