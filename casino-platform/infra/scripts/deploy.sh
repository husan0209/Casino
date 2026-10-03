#!/usr/bin/env bash
set -e
cd /opt/casino-platform
git pull origin main
docker compose -f docker-compose.prod.yml build --pull
# `up -d` блокируется до service_healthy у api/web/admin/nginx (см. docker-compose.prod.yml):
# раньше здесь был `sleep 5` «на прогревание», и деплой печатал "Deploy OK" даже когда
# nginx отдавал 502, потому что фронт ещё не слушал порт.
docker compose -f docker-compose.prod.yml up -d --remove-orphans
# Schema в packages/database/prisma, WORKDIR образа — /app, поля `prisma` в package.json
# нет: без --schema Prisma ищет ./prisma/schema.prisma от cwd и падает «Could not find a
# prisma schema file». pnpm в runtime-стадии отсутствует (corepack только в builder),
# поэтому не `pnpm --filter`, а явный путь. Та же команда — в .github/workflows/ci.yml.
docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy \
  --schema=packages/database/prisma/schema.prisma
docker compose -f docker-compose.prod.yml ps
echo "Deploy OK"
