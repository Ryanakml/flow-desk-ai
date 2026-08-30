#!/usr/bin/env bash
set -Eeuo pipefail

image_tag=${1:-}
if [[ ! ${image_tag} =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: deploy.sh <40-character git SHA>" >&2
  exit 1
fi

release_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
shared_dir=/opt/flowdesk/shared
environment_file=${shared_dir}/staging.env
current_release_file=${shared_dir}/current-image
previous_release_file=${shared_dir}/previous-image

if [[ ! -f ${environment_file} ]]; then
  echo "missing ${environment_file}" >&2
  exit 1
fi

cd "${release_dir}"
set -a
# shellcheck disable=SC1090
source "${environment_file}"
set +a
export IMAGE_TAG=${image_tag}

compose=(docker compose --env-file "${environment_file}" -f compose.yaml)
app_services=(web api ingress worker scheduler)
previous_tag=""
if [[ -f ${current_release_file} ]]; then
  previous_tag=$(<"${current_release_file}")
fi

dump_diagnostics() {
  echo "recent staging diagnostics:" >&2
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --no-color --timestamps --since 15m --tail 200 \
    caddy web api ingress worker scheduler >&2 || true
}

rollback() {
  exit_code=$?
  dump_diagnostics
  if [[ -n ${previous_tag} && ${previous_tag} =~ ^[0-9a-f]{40}$ ]]; then
    echo "deployment failed; rolling application containers back to ${previous_tag}" >&2
    export IMAGE_TAG=${previous_tag}
    "${compose[@]}" up -d --no-build --remove-orphans "${app_services[@]}" caddy || true
  fi
  exit "${exit_code}"
}
trap rollback ERR

"${compose[@]}" --profile release pull
"${compose[@]}" up -d postgres redis minio minio-init clamav
"${compose[@]}" --profile release run --rm migrate
"${compose[@]}" exec -T postgres psql \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --set "runtime_password=${POSTGRES_RUNTIME_PASSWORD}" \
  < provision-runtime.sql
"${compose[@]}" up -d --no-build --remove-orphans "${app_services[@]}" caddy

for attempt in $(seq 1 120); do
  if curl --fail --silent --show-error http://127.0.0.1/livez >/dev/null && \
    curl --fail --silent --show-error http://127.0.0.1/api/v1/system/build | grep -q "${image_tag}"; then
    break
  fi
  if [[ ${attempt} -eq 120 ]]; then
    echo "staging health gate timed out" >&2
    exit 1
  fi
  sleep 2
done

if [[ -n ${previous_tag} && ${previous_tag} != "${image_tag}" ]]; then
  printf '%s\n' "${previous_tag}" > "${previous_release_file}"
fi
printf '%s\n' "${image_tag}" > "${current_release_file}"
trap - ERR
docker image prune -f >/dev/null 2>&1 || true
echo "deployed ${image_tag}"
