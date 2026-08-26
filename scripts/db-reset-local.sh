#!/usr/bin/env bash
set -euo pipefail

if [[ "${APP_ENV:-local}" != "local" ]]; then
  echo "Refusing database reset: APP_ENV must be local." >&2
  exit 1
fi

compose_file="infra/compose/compose.yaml"
project_name="flowdesk-local"
docker compose -f "$compose_file" stop postgres
docker volume rm "${project_name}_postgres-data" 2>/dev/null || true
docker compose -f "$compose_file" up -d postgres

