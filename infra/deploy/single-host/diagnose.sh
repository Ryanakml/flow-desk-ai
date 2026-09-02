#!/usr/bin/env bash
set -Eeuo pipefail

release_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
environment_file=/opt/flowdesk/shared/staging.env
current_release_file=/opt/flowdesk/shared/current-image
since=${SINCE:-15m}
tail_lines=${TAIL_LINES:-300}

if [[ ! -f ${environment_file} ]]; then
  echo "missing ${environment_file}" >&2
  exit 1
fi

if [[ ! -f ${current_release_file} ]]; then
  echo "missing ${current_release_file}" >&2
  exit 1
fi

image_tag=$(<"${current_release_file}")
if [[ ! ${image_tag} =~ ^[0-9a-f]{40}$ ]]; then
  echo "invalid image tag in ${current_release_file}" >&2
  exit 1
fi
export IMAGE_TAG=${image_tag}

cd "${release_dir}"
compose=(docker compose --env-file "${environment_file}" -f compose.yaml)

if [[ $# -gt 0 ]]; then
  services=("$@")
else
  services=(caddy web api ingress worker scheduler)
fi

"${compose[@]}" ps
"${compose[@]}" logs --no-color --timestamps --since "${since}" --tail "${tail_lines}" "${services[@]}"
