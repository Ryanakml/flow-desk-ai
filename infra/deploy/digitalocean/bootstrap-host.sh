#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "bootstrap-host.sh must run as root" >&2
  exit 1
fi

deploy_public_key=${1:-}
if [[ ! ${deploy_public_key} =~ ^ssh-ed25519\  ]]; then
  echo "usage: bootstrap-host.sh 'ssh-ed25519 AAAA... deployment-key'" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl fail2ban gnupg ufw

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nSigned-By: /etc/apt/keyrings/docker.asc\n' "${VERSION_CODENAME}" > /etc/apt/sources.list.d/docker.sources
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! id flowdesk >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash flowdesk
fi
usermod -aG docker flowdesk
install -d -m 0700 -o flowdesk -g flowdesk /home/flowdesk/.ssh
printf '%s\n' "${deploy_public_key}" > /home/flowdesk/.ssh/authorized_keys
chown flowdesk:flowdesk /home/flowdesk/.ssh/authorized_keys
chmod 0600 /home/flowdesk/.ssh/authorized_keys

install -d -m 0750 -o flowdesk -g flowdesk /opt/flowdesk/releases /opt/flowdesk/shared
install -d -m 0755 /etc/docker
printf '%s\n' '{"log-driver":"local","log-opts":{"max-size":"10m","max-file":"3"},"live-restore":true}' > /etc/docker/daemon.json
systemctl enable --now docker fail2ban
systemctl restart docker

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment SSH
ufw allow 80/tcp comment HTTP
ufw allow 443/tcp comment HTTPS
ufw allow 443/udp comment HTTP3
ufw --force enable

echo "DigitalOcean staging host bootstrap complete"
