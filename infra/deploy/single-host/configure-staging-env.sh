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

webhook_app_secret=${WEBHOOK_APP_SECRET:-}
if [[ ${#webhook_app_secret} -lt 16 || ${webhook_app_secret} == replace-with-* ]]; then
  echo "set WEBHOOK_APP_SECRET to the real FlowDesk Meta App secret before creating staging.env" >&2
  exit 1
fi

temporary_file=$(mktemp /opt/flowdesk/shared/staging.env.XXXXXX)
cleanup_temporary_file() {
  rm -f "${temporary_file}"
}
trap cleanup_temporary_file EXIT
chmod 0600 "${temporary_file}"
environment_owner=$(stat -c '%U' /opt/flowdesk/shared)
environment_group=$(stat -c '%G' /opt/flowdesk/shared)
encryption_key=$(openssl rand -hex 24)
postgres_password=$(openssl rand -hex 24)
runtime_password=$(openssl rand -hex 24)
redis_password=$(openssl rand -hex 24)
minio_password=$(openssl rand -hex 24)
webhook_token=$(openssl rand -hex 24)
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
  "WEBHOOK_APP_SECRET=${webhook_app_secret}" \
  "META_APP_ID=replace-with-flowdesk-meta-app-id" \
  "META_APP_SECRET=replace-with-flowdesk-meta-app-secret" \
  "META_EMBEDDED_SIGNUP_CONFIG_ID=replace-with-meta-embedded-signup-config-id" \
  "META_SYSTEM_USER_ACCESS_TOKEN=replace-with-flowdesk-system-user-access-token" \
  "META_SYSTEM_USER_ID=replace-with-flowdesk-system-user-id" \
  "META_ADMIN_SYSTEM_USER_ACCESS_TOKEN=replace-with-business-admin-system-user-access-token" \
  "META_GRAPH_API_BASE_URL=https://graph.facebook.com/v25.0" \
  "AI_PROVIDER=disabled" \
  "GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta" \
  "GEMINI_CHAT_MODEL=gemini-3.7-flash" \
  "GEMINI_EMBEDDING_MODEL=gemini-embedding-2" \
  "OPENAI_BASE_URL=https://api.openai.com/v1" \
  "OPENAI_CHAT_MODEL=gpt-4o-mini" \
  "OPENAI_EMBEDDING_MODEL=text-embedding-3-small" \
  "AI_CHAT_TIMEOUT_MS=15000" \
  "AI_EMBEDDING_TIMEOUT_MS=15000" \
  "AI_MAX_OUTPUT_TOKENS=512" \
  "AUTH_OIDC_ISSUER=https://flowdesk.local.auth0.com/" \
  "AUTH_OIDC_CLIENT_ID=flowdesk-staging-client" \
  "AUTH_OIDC_CLIENT_SECRET=${oidc_secret}" \
  "AUTH_MOCK_ENABLED=true" \
  "AUTH_COOKIE_SECURE=false" \
  "LOG_LEVEL=info" > "${temporary_file}"

chown "${environment_owner}:${environment_group}" "${temporary_file}"
mv "${temporary_file}" "${environment_file}"
trap - EXIT
echo "created ${environment_file} with mode 0600"
