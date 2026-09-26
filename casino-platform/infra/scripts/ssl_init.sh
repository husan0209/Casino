#!/usr/bin/env bash
# get initial certs via certbot standalone
# run once before nginx up, with ports 80 free
#
# GAP-56: домены и email больше не захардкожены — берутся из .env
# (симлинк .env.production; DEPLOY.md), иначе — ошибка, а не молчаливый выпуск
# сертификата для чужого плейсхолдера. Имена томов совпадают с
# docker-compose.prod.yml (там certbot_certs/certbot_www заданы с name:).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$REPO_ROOT/.env" ]; then
  set -a; . "$REPO_ROOT/.env"; set +a
fi

: "${DOMAIN:?DOMAIN не задан: заполни .env.production (DOMAIN, ADMIN_DOMAIN, опц. SSL_EMAIL) — см. ENVIRONMENT_VARIABLES §2}"
: "${ADMIN_DOMAIN:?ADMIN_DOMAIN не задан: заполни .env.production}"
EMAIL="${SSL_EMAIL:-admin@$DOMAIN}"

DOMAINS="$DOMAIN $ADMIN_DOMAIN"
for d in $DOMAINS; do
  docker run --rm -p 80:80 \
    -v certbot_certs:/etc/letsencrypt \
    -v certbot_www:/var/www/certbot \
    certbot/certbot certonly --standalone \
    -d $d --email $EMAIL --agree-tos --no-eff-email --force-renewal || true
done
echo "Certs issued for: $DOMAINS. Now docker compose up nginx"
# renew cron (монтирует те же именованные тома)
# 0 3 * * * docker run --rm -v certbot_certs:/etc/letsencrypt -v certbot_www:/var/www/certbot certbot/certbot renew --quiet && docker compose -f /opt/casino-platform/docker-compose.prod.yml exec nginx nginx -s reload
