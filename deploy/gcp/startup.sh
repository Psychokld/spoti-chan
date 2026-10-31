#!/usr/bin/env bash
# Compute Engine startup script: install official Docker packages and checkout code.
# No credentials or user tokens belong in instance metadata or this script.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
ARCH="$(dpkg --print-architecture)"
# shellcheck source=/dev/null
. /etc/os-release
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $ARCH
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if [[ ! -d /opt/spoti-chan/.git ]]; then
  git clone https://github.com/Psychokld/spoti-chan.git /opt/spoti-chan
fi
printf 'Docker installed. Configure /opt/spoti-chan/.env and start Compose manually.\n'
