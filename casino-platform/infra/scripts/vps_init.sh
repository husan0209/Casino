#!/usr/bin/env bash
set -e
# Hetzner CX41 Ubuntu 24.04 bootstrap
# run as root
export DEBIAN_FRONTEND=noninteractive
apt update && apt upgrade -y
apt install -y ufw fail2ban docker.io docker-compose-plugin git curl wget htop unzip certbot

# UFW
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# fail2ban – ssh + nginx
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled = true
maxretry = 5
bantime = 3600
[nginx-http-auth]
enabled = true
[nginx-limit-req]
enabled = true
JAIL
systemctl restart fail2ban

# docker
systemctl enable --now docker

# swap 2G (CX41 has 8GB, still safe)
if ! swapon --show | grep -q swap; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# deploy user
id -u deploy &>/dev/null || useradd -m -s /bin/bash deploy
usermod -aG docker deploy

# app dir
mkdir -p /opt/casino-platform /var/www/uploads /var/log/casino
chown -R deploy:deploy /opt/casino-platform /var/www/uploads /var/log/casino

echo "VPS init done. Next: su deploy, cd /opt/casino-platform, git clone ..., cp .env.production, docker compose -f docker-compose.prod.yml up -d"
