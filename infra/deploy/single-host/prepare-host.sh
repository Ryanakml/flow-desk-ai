#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "prepare-host.sh must run as root" >&2
  exit 1
fi

deploy_user=${1:-}
if [[ -z ${deploy_user} || ! ${deploy_user} =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "usage: prepare-host.sh <existing-deploy-user>" >&2
  exit 1
fi
if ! id "${deploy_user}" >/dev/null 2>&1; then
  echo "deployment user ${deploy_user} does not exist" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with the Compose plugin must already be installed" >&2
  exit 1
fi

deploy_group=$(id -gn "${deploy_user}")
if ! getent group docker >/dev/null 2>&1; then
  groupadd --system docker
fi
usermod -aG docker "${deploy_user}"
install -d -m 0750 -o "${deploy_user}" -g "${deploy_group}" \
  /opt/flowdesk/releases \
  /opt/flowdesk/shared

if [[ -e /opt/flowdesk/shared/staging.env ]]; then
  chown "${deploy_user}:${deploy_group}" /opt/flowdesk/shared/staging.env
  chmod 0600 /opt/flowdesk/shared/staging.env
fi

echo "Prepared /opt/flowdesk for ${deploy_user}. Start a new login session before using Docker without sudo."
