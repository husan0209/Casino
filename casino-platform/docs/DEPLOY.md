# Deploy – Casino Platform

## CI/CD pipeline (фактический)

Единый workflow — `.github/workflows/ci.yml` (отдельного `deploy.yml` нет):

1. **PR / push**: `secrets-scan` → `commitlint` → `audit` (`pnpm audit --prod`, ratchet-базлайн) →
   `lint-typecheck-test` (vitest + интеграционные на Postgres при `LEDGER_INTEGRATION=1`, шаг
   E2E player-lifecycle там же) → `docs-guard` + `Architecture guards`;
   `docker-build` собирает **все три прод-образа** (api/web/admin) и на PR, и на push в `main` (GAP-60).
2. **Deploy job** (`Deploy to VPS (only after green CI)`) — только push в `main` (или
   `workflow_dispatch`), после 4 зелёных чеков (`needs:`): `secrets-scan`, `commitlint`,
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
nano .env.production
# edit .env.production — обязательно:
#   все секреты, JWT >=64 chars, REDIS_PASSWORD, RUKASSA_*, NOWPAYMENTS_*, SMTP_*
#   DOMAIN + ADMIN_DOMAIN (nginx-шаблон и ssl_init.sh, GAP-56; опц. SSL_EMAIL)
#   DB_USER / DB_PASSWORD / DB_NAME — согласованы с DATABASE_URL (контейнер postgres, GAP-56)
ln -sf .env.production .env
# ⚠️ .env.production НЕ закрыт в .gitignore (там только `.env` и `.env*.local` —
# `git check-ignore .env.production` даёт exit 1). Файл с секретами лежит в рабочем
# дереве git: не коммитить его и не протаскивать через `git add -A`
# (подтверждено в SECURITY_CHECKLIST, раздел Data).

# SSL first
docker compose -f docker-compose.prod.yml up -d postgres redis
# get certs
bash infra/scripts/ssl_init.sh

# full up
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy

# check
# ⚠️ ЗАПОЛНИТЬ ПРИ ВВОДЕ В ЭКСПЛУАТАЦИЮ (GAP-46): реальный домен/хост стенда НЕИЗВЕСТЕН —
# DOMAIN/ADMIN_DOMAIN задает оператор в .env.production (см. выше), в репозитории их нет.
# Плейсхолдер casino.example.com из этого файла убран намеренно: он не рабочий адрес.
curl "https://$DOMAIN/api/v1/health/ready"   # $DOMAIN — из .env.production (dotenv уже в шелле: set -a; . ./.env)
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
- UptimeRobot → `https://<DOMAIN>/api/v1/health/ready` — **заполнить при вводе в эксплуатацию
  (GAP-46)**: домен выбирает оператор в `.env.production` (`DOMAIN`), рабочего адреса в репозитории нет.
  Честный readiness: БД 503 при недоступности, Redis → degraded — GAP-35.
- Logs: `docker compose logs -f api`
- Email-воркер: консьюмер очереди `email` — отдельный сервис `worker` (тот же образ, что api, `apps/api/src/worker.ts`), логи `docker compose logs -f worker`; в процессе API он отключён флагом `EMAIL_WORKER_IN_PROCESS=false`
- DB: `SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;`

## Backup

Бэкап делает **cron на хосте** (тот же `deploy`-пользователь, что и `resource-check.sh`):

```bash
0 2 * * * /opt/casino-platform/infra/scripts/postgres-backup.sh
```

Скрипт хостовый по конструкции: сам читает `.env` (`.env.production`, симлинк) ради `DB_USER`/`DB_NAME`,
берёт контейнер через `docker ps` и льёт `pg_dump | gzip` в `/opt/casino-backups`, держит 14 дней
(`find ... -mtime +14 -delete`), опционально `rclone copy` на S3 в конце файла.

⚠️ **Но он не должен быть initdb-скриптом.** Сейчас он дополнительно примонтирован в
`/docker-entrypoint-initdb.d/backup.sh` (`docker-compose.prod.yml:11`), а Postgres выполняет содержимое
этого каталога **только при первом старте с пустым data-томом**. Внутри контейнера нет ни `docker` CLI,
ни переменных `DB_USER`/`DB_NAME` (compose передаёт только `POSTGRES_*`), а `postgres-backup.sh` идёт под
`set -euo pipefail` с `: "${DB_USER:?...}"` → он падает и **обрывает инициализацию БД на пустом томе**
(первый деплой не поднимается). Mount убирается в отдельной ветке (не этим файлом); до его мержа —
не поднимать прод с пустым `pgdata`. Проверка после первого ночного прогона: `ls -lh /opt/casino-backups`.

## Rollback

Кода-откат: `bash infra/scripts/rollback.sh` (= `git checkout HEAD~1` → rebuild api/web/admin → up → health-check; GAP-56 — docker compose, без pm2), или вручную:

```bash
cd /opt/casino-platform
git checkout <prev-tag>
docker compose -f docker-compose.prod.yml build api web admin
docker compose -f docker-compose.prod.yml up -d
```

DB rollback: restore from `/opt/casino-backups/casino_YYYY-MM-DD_HHMM.sql.gz`
(скрипт восстановления — `infra/scripts/restore.sh`; сначала `--dry-run`, GAP-56).
⚠️ GAP-46 п.7: учебное восстановление из бэкапа обязано быть прогнано до приёма реальных денег.
