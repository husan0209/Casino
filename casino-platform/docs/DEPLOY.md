# Deploy – Casino Platform

## CI/CD pipeline (фактический)

Единый workflow — `.github/workflows/ci.yml` (отдельного `deploy.yml` нет):

1. **PR / push**: `secrets-scan` → `commitlint` → `lint-typecheck-test` (vitest + интеграционные
   на Postgres при `LEDGER_INTEGRATION=1`) → `docs-guard` + `Architecture guards`;
   на PR дополнительно E2E-прогон, на main — `docker-build` (образ API собирается на каждый merge).
2. **Deploy job** (`Deploy to VPS (only after green CI)`) — только push в `main` (или
   `workflow_dispatch`), после 4 зелёных чеков: `secrets-scan`, `commitlint`,
   `lint-typecheck-test`, `docker-build`. Без настроенных секретов `VPS_HOST` / `VPS_USER` /
   `VPS_SSH_KEY` job **пропускается с notice** (deploy-skip), основной CI остаётся зелёным.
3. На VPS job выполняет: `git pull` → `docker compose build --pull` → `up -d` →
   `npx prisma migrate deploy` (миграции применяются автоматически на деплое — GAP-31).

`workflow_dispatch` доступен только с default-ветки (правило репо).

## 1st deploy – Hetzner CX41 Ubuntu 24.04

```bash
# as root
curl -fsSL https://raw.githubusercontent.com/your/repo/main/infra/scripts/vps_init.sh | bash

su deploy
cd /opt
git clone https://github.com/your/casino-platform.git /opt/casino-platform
cd /opt/casino-platform
cp .env.example .env.production
# edit .env.production – set all secrets, JWT >=64 chars, DB_PASSWORD, REDIS_PASSWORD, RUKASSA_*, NOWPAYMENTS_*, SMTP_*, etc.
nano .env.production
ln -sf .env.production .env

# SSL first
docker compose -f docker-compose.prod.yml up -d postgres redis
# get certs
bash infra/scripts/ssl_init.sh

# full up
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy

# check
curl https://casino.example.com/api/v1/health/ready
```

## Первичная инициализация админа (обязательно)

Первый superadmin создаётся сидом `packages/database/src/seed.ts` (`pnpm db:seed` локально /
`docker compose -f docker-compose.prod.yml exec api npx prisma db seed` на VPS). Перед запуском
задай **обязательные** переменные в `.env.production`:

```bash
SEED_ADMIN_EMAIL=you@your-domain.com        # login в админку
SEED_ADMIN_PASSWORD=<сгенерированный пароль>
```

⚠️ **Fail-closed (GAP-38):** при `NODE_ENV=production` сид **отказывается работать** без
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` и с дефолтным dev-паролем
`dev_superadmin_password_123`. Повторный запуск идемпотентен (admin upsert по email).

## Monitoring / resource-check

- Cron каждые 5 минут: `*/5 * * * * /opt/casino-platform/infra/scripts/resource-check.sh`
  (пороги из ТЗ ч.7 §12.3: CPU > 85%, RAM > 90%, disk > 85% — ALERT в stdout/Journald,
  плюс проба `/api/v1/health/ready`).
- UptimeRobot → `https://casino.example.com/api/v1/health/ready` (честный readiness: БД 503
  при недоступности, Redis → degraded — GAP-35).
- Logs: `docker compose logs -f api`
- DB: `SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;`

## Backup
Cron: `0 2 * * * /opt/casino-platform/infra/scripts/postgres-backup.sh`
Keeps 14 days in `/opt/casino-backups`, optionally sync to S3.

## Rollback
```bash
cd /opt/casino-platform
git checkout <prev-tag>
docker compose -f docker-compose.prod.yml build api web admin
docker compose -f docker-compose.prod.yml up -d
```
DB rollback: restore from `/opt/casino-backups/casino_YYYY-MM-DD_HHMM.sql.gz`
(скрипт восстановления — `infra/scripts/restore.sh`).
