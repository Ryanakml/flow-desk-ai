#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "${script_dir}/health-check.sh"

if [[ ${EUID} -ne 0 ]]; then
  echo "configure-staging-env.sh must run as root" >&2
  exit 1
fi

public_base_url=${1:-}
if ! valid_public_base_url "${public_base_url}"; then
  echo "usage: configure-staging-env.sh <https-base-url>" >&2
  exit 1
fi
public_base_url=${public_base_url%/}

environment_file=/opt/flowdesk/shared/staging.env
if [[ -f ${environment_file} ]]; then
  echo "${environment_file} already exists; leaving secrets unchanged"
  exit 0
fi

temporary_file=$(mktemp /opt/flowdesk/shared/staging.env.XXXXXX)
chmod 0600 "${temporary_file}"
encryption_key=$(openssl rand -hex 24)
postgres_password=$(openssl rand -hex 24)
runtime_password=$(openssl rand -hex 24)
redis_password=$(openssl rand -hex 24)
minio_password=$(openssl rand -hex 24)
webhook_token=$(openssl rand -hex 24)
webhook_secret=$(openssl rand -hex 32)
oidc_secret=$(openssl rand -hex 24)

printf '%s\n' \
  "IMAGE_REGISTRY=ghcr.io/ryanakml" \
  "SITE_ADDRESS=${public_base_url#https://}" \
  "PUBLIC_BASE_URL=${public_base_url}" \
  "ENCRYPTION_KEY=${encryption_key}" \
  "POSTGRES_DB=flowdesk_staging" \
  "POSTGRES_USER=flowdesk_bootstrap" \
  "POSTGRES_PASSWORD=${postgres_password}" \
  "POSTGRES_RUNTIME_PASSWORD=${runtime_password}" \
  "REDIS_PASSWORD=${redis_password}" \
  "MINIO_ROOT_USER=flowdesk_staging" \
  "MINIO_ROOT_PASSWORD=${minio_password}" \
  "WEBHOOK_VERIFY_TOKEN=${webhook_token}" \
  "WEBHOOK_APP_SECRET=${webhook_secret}" \
  "AUTH_OIDC_ISSUER=https://flowdesk.local.auth0.com/" \
  "AUTH_OIDC_CLIENT_ID=flowdesk-staging-client" \
  "AUTH_OIDC_CLIENT_SECRET=${oidc_secret}" \
  "AUTH_MOCK_ENABLED=true" \
  "AUTH_COOKIE_SECURE=false" \
  "LOG_LEVEL=info" > "${temporary_file}"

chown flowdesk:flowdesk "${temporary_file}"
mv "${temporary_file}" "${environment_file}"
echo "created ${environment_file} with mode 0600"
