#!/usr/bin/env bash
# Local-only entry point. Never forwards arbitrary flags or uses a linked project.
set -euo pipefail
cd "$(dirname "$0")/../.."
expected=$(<supabase/.cli-version)
actual=$(supabase --version)
[[ "$actual" == "$expected" ]] || { printf 'Expected Supabase CLI %s; got %s\n' "$expected" "$actual" >&2; exit 1; }
[[ $# -eq 1 ]] || { printf 'Usage: bash scripts/supabase/local.sh start|reset|test|lint|advisors|types|types-check|verify|stop\n' >&2; exit 2; }
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
case "$1" in
  start) supabase start ;;
  reset) supabase db reset --local --yes ;;
  test) supabase test db --local ;;
  lint) supabase db lint --local --schema api,private --fail-on warning ;;
  advisors) supabase db advisors --local --type security --level warn --fail-on error ;;
  types) bash scripts/supabase/types.sh write ;;
  types-check) bash scripts/supabase/types.sh check ;;
  verify)
    bash scripts/supabase/local.sh reset
    bash scripts/supabase/local.sh test
    bash scripts/supabase/local.sh lint
    bash scripts/supabase/local.sh advisors
    bash scripts/supabase/local.sh types-check
    # Reconstruct a second time; resetting must not depend on previous state.
    bash scripts/supabase/local.sh reset
    bash scripts/supabase/local.sh test
    bash scripts/supabase/local.sh types-check
    ;;
  stop) supabase stop --no-backup ;;
  *) printf 'Unknown local operation: %s\n' "$1" >&2; exit 2 ;;
esac
