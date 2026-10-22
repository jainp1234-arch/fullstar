#!/bin/sh
# Plan 9.2 ZAP stack: the roles of infra/db/bootstrap-roles.sql on the throwaway database.
set -eu
psql -v ON_ERROR_STOP=1 -X -q -U postgres -d fullstar -f /bootstrap/bootstrap-roles.sql
