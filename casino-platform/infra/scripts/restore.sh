#!/usr/bin/env bash
# Restore database from a gzip'ed pg_dump made by infra/scripts/postgres-backup.sh.
#
# GAP-56: переписан под фактический docker-compose.prod.yml. Старая версия ссылалась
# на контейнер `casino-db`, пользователя `postgres` и каталог /var/backups/casino —
# none of which exist: сервис называется postgres (контейнер casino-platform-postgres-1),
# имена БД — DB_USER/DB_NAME из .env, бэкапы лежат в /opt/casino-backups.
# GAP-46 п.7: учебное восстановление ОБЯЗАТЕЛЬНО до приёма реальных денег.
#
# Usage:
#   bash infra/scripts/restore.sh                                  # показать список бэкапов
#   bash infra/scripts/restore.sh <файл.sql.gz> --dry-run          # репетиция без изменений
#   bash infra/scripts/restore.sh <файл.sql.gz> [--yes]            # восстановление
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="/opt/casino-backups"
COMPOSE=(docker compose -f docker-compose.prod.yml)

cd "$REPO_ROOT"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${DB_USER:?DB_USER не задан — заполни .env.production (см. ENVIRONMENT_VARIABLES §3)}"
: "${DB_NAME:?DB_NAME не задан — заполни .env.production}"

PG_CONTAINER="$(${COMPOSE[*]} ps -q postgres | head -1)"
if [ -z "$PG_CONTAINER" ]; then
  echo "❌ Контейнер postgres не запущен: сначала ${COMPOSE[*]} up -d postgres"
  exit 1
fi

# ── без аргумента: список доступных бэкапов ────────────────────────────────
if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup_file.sql.gz> [--dry-run] [--yes]"
  echo "Available backups in $BACKUP_DIR:"
  ls -lht "$BACKUP_DIR"/casino_*.sql.gz 2>/dev/null || echo "  (нет бэкапов — сначала cron postgres-backup.sh или ручной прогон)"
  exit 1
fi

DRY_RUN=0; ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    -*|--) ;;
    *) BACKUP_FILE="$arg" ;;
  esac
done
BACKUP_FILE="${BACKUP_FILE:?не указан файл бэкапа}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Файл не найден: $BACKUP_FILE"
  ls -lht "$BACKUP_DIR"/casino_*.sql.gz 2>/dev/null || true
  exit 1
fi

echo "Контейнер:  $(docker inspect --format '{{.Name}}' "$PG_CONTAINER" | sed 's|^/||')"
echo "БД:         $DB_NAME (пользователь $DB_USER)"
echo "Бэкап:      $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── целостность дампа до любых изменений ───────────────────────────────────
if ! gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "❌ Дамп повреждён (gunzip -t упал) — восстановление отменено"
  exit 1
fi
echo "Целостность gzip: OK"

if [ "$DRY_RUN" = 1 ]; then
  echo
  echo "── DRY RUN: изменения НЕ применялись. План восстановления: ──"
  echo "  1) ${COMPOSE[*]} stop api                    (остановить писателей)"
  echo "  2) DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE); CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  echo "  3) gunzip -c <дамп> | docker exec -i <postgres> psql -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1"
  echo "  4) ${COMPOSE[*]} up -d api && migrate deploy"
  echo "  5) проба /health/ready внутри контейнера api"
  exit 0
fi

if [ "$ASSUME_YES" != 1 ]; then
  echo
  echo "⚠️  ТЕКУЩАЯ БАЗА $DB_NAME БУДЕТ УДАЛЕНА и заменена содержимым дампа."
  read -r -p "Продолжить? (y/N) " -n 1 REPLY; echo
  case "$REPLY" in
    [Yy]) ;;
    *) echo "Отменено."; exit 1 ;;
  esac
fi

echo "Останавливаю api..."
${COMPOSE[*]} stop api

echo "Пересоздаю БД $DB_NAME..."
docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" \
  -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "Заливаю дамп..."
gunzip -c "$BACKUP_FILE" | docker exec -i "$PG_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1

echo "Поднимаю api и применяю миграции..."
${COMPOSE[*]} up -d api
${COMPOSE[*]} exec -T api npx prisma migrate deploy

echo "Проба /health/ready..."
for i in 1 2 3 4 5 6; do
  sleep 5
  if ${COMPOSE[*]} exec -T api wget -qO- http://localhost:3001/api/v1/health/ready | grep -q '"status":"ok"'; then
    echo "✅ Restore complete, API healthy (попытка $i)."
    exit 0
  fi
  echo "  API ещё не готов (попытка $i/6)..."
done
echo "❌ Дамп залит, но /health/ready не отвечает 'ok' — смотри docker compose logs api"
exit 1
