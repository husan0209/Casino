#!/usr/bin/env bash
set -e

# GAP-56: приведён к docker compose по DEPLOY.md § Rollback. Прежняя версия звала
# pm2 и pnpm build — на VPS их нет, деплой идёт docker-образами.
# Откат БД (если нужен) — infra/scripts/restore.sh из дампа, см. DEPLOY.md § Rollback.

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)/../.."
cd "$REPO_ROOT"

PREVIOUS_COMMIT=$(git rev-parse HEAD~1)

echo "Rolling back to $PREVIOUS_COMMIT"
git checkout "$PREVIOUS_COMMIT"

echo "Rebuilding images (api, web, admin)..."
docker compose -f docker-compose.prod.yml build api web admin

echo "Restarting services..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "Running health check..."
./infra/scripts/health-check.sh

echo "Rollback successful."
