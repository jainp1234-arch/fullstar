-- Schema §14 V1: schema app, roles app_api and app_system (BYPASSRLS), grants.
-- Flyway runs as app_owner, which owns every object (Schema §7).
-- On Neon the roles are created beforehand by infra/db/bootstrap-roles.sql (Plan 1.2 trial override);
-- here they are only created when missing (e.g. a fresh superuser database).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    CREATE ROLE app_system NOLOGIN BYPASSRLS;
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_system') THEN
    RAISE EXCEPTION 'app_system must have BYPASSRLS';
  END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_api') THEN
    RAISE EXCEPTION 'app_api must not have BYPASSRLS';
  END IF;
END $$;

CREATE SCHEMA app;

GRANT USAGE ON SCHEMA app TO app_api, app_system;

-- Objects created later by app_owner in schema app
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api, app_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_api, app_system;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO app_api, app_system;
