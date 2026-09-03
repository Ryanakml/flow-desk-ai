#!/usr/bin/env bash
set -Eeuo pipefail

# Production Migration Expand-Contract Validator
# Ensures that no active production schema changes drop columns or introduce non-default NOT NULL constraints.

MIGRATIONS_DIR="packages/db/migrations"

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "::error::Migrations directory ${MIGRATIONS_DIR} not found"
  exit 1
fi

echo "Validating expand-contract compatibility for migrations in ${MIGRATIONS_DIR}..."

VIOLATIONS=0

while IFS= read -r -d '' sql_file; do
  # Check for DROP COLUMN
  if grep -inE '\bDROP\s+COLUMN\b' "${sql_file}"; then
    echo "::error file=${sql_file}::Breaking change: DROP COLUMN detected in ${sql_file}."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # Check for DROP TABLE
  if grep -inE '\bDROP\s+TABLE\b' "${sql_file}"; then
    echo "::error file=${sql_file}::Breaking change: DROP TABLE detected in ${sql_file}."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # Check for ADD COLUMN NOT NULL without DEFAULT
  if grep -inE '\bADD\s+COLUMN\b' "${sql_file}" | grep -inE '\bNOT\s+NULL\b' | grep -vinE '\bDEFAULT\b'; then
    echo "::error file=${sql_file}::Breaking change: ADD COLUMN NOT NULL without DEFAULT detected in ${sql_file}."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(find "${MIGRATIONS_DIR}" -name "*.sql" -print0)

if (( VIOLATIONS > 0 )); then
  echo "Migration expand validation FAILED with ${VIOLATIONS} breaking changes." >&2
  exit 1
fi

echo "Migration expand validation PASSED: all schema migrations are backwards-compatible."
