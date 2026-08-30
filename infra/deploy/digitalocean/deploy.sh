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
health_base_url=http://127.0.0.1
health_deadline_seconds=${STAGING_HEALTH_DEADLINE_SECONDS:-240}
health_retry_interval_seconds=${STAGING_HEALTH_RETRY_INTERVAL_SECONDS:-2}
caddy_stabilization_seconds=${CADDY_STABILIZATION_SECONDS:-5}
curl_connect_timeout_seconds=${STAGING_HEALTH_CURL_CONNECT_TIMEOUT_SECONDS:-3}
curl_max_time_seconds=${STAGING_HEALTH_CURL_MAX_TIME_SECONDS:-10}
for numeric_setting in \
  health_deadline_seconds \
  health_retry_interval_seconds \
  caddy_stabilization_seconds \
  curl_connect_timeout_seconds \
  curl_max_time_seconds; do
  if ! [[ ${!numeric_setting} =~ ^[0-9]+$ ]]; then
    echo "${numeric_setting} must be a non-negative integer" >&2
    exit 1
  fi
done
if ((health_deadline_seconds == 0 || health_retry_interval_seconds == 0 || curl_connect_timeout_seconds == 0 || curl_max_time_seconds == 0)); then
  echo "health deadline, retry interval, and curl timeouts must be greater than zero" >&2
  exit 1
fi
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

health_started_at=${SECONDS}
health_deadline_at=$((health_started_at + health_deadline_seconds))
health_attempt=0
health_passed=false
echo "staging health gate: expected_sha=${image_tag} deadline_seconds=${health_deadline_seconds} retry_interval_seconds=${health_retry_interval_seconds}" >&2

if ((caddy_stabilization_seconds > 0)); then
  stabilization_sleep_seconds=${caddy_stabilization_seconds}
  if ((stabilization_sleep_seconds > health_deadline_seconds)); then
    stabilization_sleep_seconds=${health_deadline_seconds}
  fi
  echo "staging health gate: waiting ${stabilization_sleep_seconds}s for Caddy stabilization" >&2
  sleep "${stabilization_sleep_seconds}"
fi

while ((SECONDS < health_deadline_at)); do
  ((health_attempt += 1))
  livez_body=$(mktemp)
  livez_error=$(mktemp)
  build_body=$(mktemp)
  build_error=$(mktemp)
  livez_exit=0
  build_exit=0
  livez_status="000"
  build_status="not_checked"
  observed_sha="unavailable"

  if livez_status=$(curl \
    --fail --silent --show-error \
    --connect-timeout "${curl_connect_timeout_seconds}" \
    --max-time "${curl_max_time_seconds}" \
    --output "${livez_body}" --write-out '%{http_code}' \
    "${health_base_url}/livez" 2>"${livez_error}"); then
    :
  else
    livez_exit=$?
  fi

  if [[ ${livez_exit} -eq 0 && ${livez_status} == "200" ]]; then
    if build_status=$(curl \
      --fail --silent --show-error \
      --connect-timeout "${curl_connect_timeout_seconds}" \
      --max-time "${curl_max_time_seconds}" \
      --output "${build_body}" --write-out '%{http_code}' \
      "${health_base_url}/api/v1/system/build" 2>"${build_error}"); then
      :
    else
      build_exit=$?
    fi
    observed_sha=$(sed -nE 's/.*"gitSha"[[:space:]]*:[[:space:]]*"([0-9a-f]{40})".*/\1/p' "${build_body}" | head -n 1)
    observed_sha=${observed_sha:-unavailable}
  fi

  if [[ ${livez_exit} -eq 0 && ${livez_status} == "200" && ${build_exit} -eq 0 && ${build_status} == "200" && ${observed_sha} == "${image_tag}" ]]; then
    rm -f "${livez_body}" "${livez_error}" "${build_body}" "${build_error}"
    echo "staging health gate passed: attempt=${health_attempt} expected_sha=${image_tag} observed_sha=${observed_sha}" >&2
    health_passed=true
    break
  fi

  livez_error_text=$(tr '\n' ' ' < "${livez_error}")
  build_error_text=$(tr '\n' ' ' < "${build_error}")
  rm -f "${livez_body}" "${livez_error}" "${build_body}" "${build_error}"
  echo "staging health retry: attempt=${health_attempt} livez_status=${livez_status} livez_exit=${livez_exit} livez_error=${livez_error_text:-none} build_status=${build_status} build_exit=${build_exit} build_error=${build_error_text:-none} expected_sha=${image_tag} observed_sha=${observed_sha}" >&2

  remaining_seconds=$((health_deadline_at - SECONDS))
  if ((remaining_seconds <= 0)); then
    break
  fi
  sleep_seconds=${health_retry_interval_seconds}
  if ((sleep_seconds > remaining_seconds)); then
    sleep_seconds=${remaining_seconds}
  fi
  sleep "${sleep_seconds}"
done

if [[ ${health_passed} != true ]]; then
  echo "staging health gate timed out: attempts=${health_attempt} expected_sha=${image_tag} deadline_seconds=${health_deadline_seconds}" >&2
  exit 1
fi

if [[ -n ${previous_tag} && ${previous_tag} != "${image_tag}" ]]; then
  printf '%s\n' "${previous_tag}" > "${previous_release_file}"
fi
printf '%s\n' "${image_tag}" > "${current_release_file}"
trap - ERR
docker image prune -f >/dev/null 2>&1 || true
echo "deployed ${image_tag}"
