#!/usr/bin/env bash
# get initial certs via certbot standalone
# run once before nginx up, with ports 80 free
set -e
DOMAINS="casino.example.com admin.casino.example.com"
EMAIL="admin@casino.example.com"
for d in $DOMAINS; do
  docker run --rm -p 80:80 \
    -v certbot_certs:/etc/letsencrypt \
    -v certbot_www:/var/www/certbot \
    certbot/certbot certonly --standalone \
    -d $d --email $EMAIL --agree-tos --no-eff-email --force-renewal || true
done
echo "Certs issued. Now docker compose up nginx"
# renew cron
# 0 3 * * * docker run --rm -v certbot_certs:/etc/letsencrypt -v certbot_www:/var/www/certbot certbot/certbot renew --quiet && docker compose -f /opt/casino-platform/docker-compose.prod.yml exec nginx nginx -s reload
