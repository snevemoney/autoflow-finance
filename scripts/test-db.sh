#!/usr/bin/env bash
# Runs every migration in supabase/migrations on a throwaway Postgres database (with
# Supabase stand-ins), then the automation/RLS test suites. Needs a local Postgres you can
# reach with psql. PGHOST/PGUSER/... are respected; default: local socket as the current user.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-autoflow_test}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
run() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" > /dev/null; }
run supabase/tests/00_supabase_stubs.sql
for f in supabase/migrations/*.sql; do run "$f"; done
echo "migrations: OK ($(ls supabase/migrations/*.sql | wc -l) files)"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=notice"
for t in supabase/tests/[1-9]*.sql; do
  psql -q -v ON_ERROR_STOP=1 -o /dev/null -d "$DB" -f "$t" 2>&1 | sed -E "s/^psql:[^ ]+ (NOTICE:  )?//"
done
echo "tests: OK"
