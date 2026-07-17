#!/usr/bin/env bash
# /opt/casino-platform/infra/scripts/postgres-backup.sh
set -euo pipefail
BACKUP_DIR="/opt/casino-backups"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%F_%H%M)
CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)
docker exec "$CONTAINER" pg_dump -U "${DB_USER:-casino}" "${DB_NAME:-casino_prod}" | gzip > "$BACKUP_DIR/casino_$DATE.sql.gz"
# keep 14 days
find "$BACKUP_DIR" -name "casino_*.sql.gz" -mtime +14 -delete
echo "Backup OK $DATE"
# optional: rclone / S3 sync here
# rclone copy "$BACKUP_DIR" s3remote:casino-backups/
