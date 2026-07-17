#!/usr/bin/env bash
set -e
cd /opt/casino-platform
git pull origin main
docker compose -f docker-compose.prod.yml build --pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
sleep 5
docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml ps
echo "Deploy OK"
