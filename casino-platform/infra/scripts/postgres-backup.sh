#!/usr/bin/env bash
# /opt/casino-platform/infra/scripts/postgres-backup.sh
set -euo pipefail
# GAP-56: имена БД берутся из .env (симлинк .env.production) — раньше молчаливые
# дефолты ${DB_USER:-casino}/${DB_NAME:-casino_prod} могли разойтись с реальными
# и cron каждую ночь падал или снимал пустую БД.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$REPO_ROOT/.env" ]; then set -a; . "$REPO_ROOT/.env"; set +a; fi
: "${DB_USER:?DB_USER не задан — заполни .env.production (см. ENVIRONMENT_VARIABLES §3)}"
: "${DB_NAME:?DB_NAME не задан — заполни .env.production}"

BACKUP_DIR="/opt/casino-backups"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%F_%H%M)
CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/casino_$DATE.sql.gz"
# keep 14 days
find "$BACKUP_DIR" -name "casino_*.sql.gz" -mtime +14 -delete
echo "Backup OK $DATE"
# optional: rclone / S3 sync here
# rclone copy "$BACKUP_DIR" s3remote:casino-backups/
