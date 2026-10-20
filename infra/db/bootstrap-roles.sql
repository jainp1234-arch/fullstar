-- One-time role setup before Flyway V1 (Plan 1.2, trial override). Run as the database owner
-- (Neon: the default owner role) through infra/db/bootstrap-roles.sh, which supplies the passwords
-- as environment variables. Safe to re-run: existing roles get the new passwords.
\set ON_ERROR_STOP on
\getenv app_owner_password APP_OWNER_PASSWORD
\getenv app_api_password APP_API_PASSWORD
\getenv app_system_password APP_SYSTEM_PASSWORD

SELECT 'CREATE ROLE app_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') \gexec
SELECT 'CREATE ROLE app_api' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') \gexec
SELECT 'CREATE ROLE app_system' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') \gexec

-- app_owner owns the schema objects (Flyway); app_api is RLS-bound; app_system bypasses RLS (Schema §7)
ALTER ROLE app_owner  WITH LOGIN NOBYPASSRLS PASSWORD :'app_owner_password';
ALTER ROLE app_api    WITH LOGIN NOBYPASSRLS PASSWORD :'app_api_password';
ALTER ROLE app_system WITH LOGIN BYPASSRLS   PASSWORD :'app_system_password';

SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO app_owner', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO app_api, app_system', current_database()) \gexec
