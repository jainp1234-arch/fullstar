-- Schema §4.1 Reference and people (CREATE SCHEMA app is in V1)
-- Generated verbatim from docs/05-backend-schema.html; do not edit by hand (Schema §1 rule 1).

CREATE TABLE app.subjects (
  id         smallint PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code IN ('english','hindi','maths','evs','computer')),
  name       text NOT NULL,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE app.class_subjects (
  class_level smallint NOT NULL CHECK (class_level BETWEEN 1 AND 5),
  subject_id  smallint NOT NULL REFERENCES app.subjects(id),
  PRIMARY KEY (class_level, subject_id)
);

CREATE TABLE app.families (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_user_id      text NOT NULL UNIQUE,
  consent_version       text NOT NULL,
  consent_at            timestamptz NOT NULL,
  pin_hash              text,                                   -- BCrypt (strength 12); NULL until set
  pin_failed_count      smallint NOT NULL DEFAULT 0,
  pin_locked_until      timestamptz,
  daily_limit_minutes   smallint NOT NULL DEFAULT 30 CHECK (daily_limit_minutes IN (20,30,45,60)),
  sound_enabled         boolean NOT NULL DEFAULT true,
  celebrations_enabled  boolean NOT NULL DEFAULT true,
  deletion_requested_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.children (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES app.families(id) ON DELETE CASCADE,
  first_name  varchar(40) NOT NULL CHECK (length(btrim(first_name)) > 0),
  age         smallint NOT NULL CHECK (age BETWEEN 4 AND 12),
  class_level smallint NOT NULL CHECK (class_level BETWEEN 1 AND 5),
  avatar_key  text NOT NULL CHECK (avatar_key IN ('cat','dog','lion','panda','rabbit','tiger',
                                                  'fox','koala','monkey','penguin','frog','unicorn')),
  stars_total integer NOT NULL DEFAULT 0 CHECK (stars_total >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX children_family_idx ON app.children(family_id);

CREATE TABLE app.staff_users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_user_id text NOT NULL UNIQUE,
  display_name     varchar(80) NOT NULL,
  role             text NOT NULL CHECK (role IN ('content_admin','super_admin')),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
