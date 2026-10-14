#!/usr/bin/env bash
# /opt/casino-platform/infra/scripts/house-backup.sh
#
# Бэкап папки клиентов house-оригиналов: apps/web/public/house/**
#
# ЗАЧЕМ ОН НУЖЕН. Эта папка намеренно не живёт в git (см. .gitignore: клиенты
# Construct ~320 МБ, лицензия на ассеты не проверена; наружу из папки игры идёт
# только cover.jpg). Значит репозиторий её не восстанавливает, а git-выкатка не
# обновляет и не удаляет: единственный экземпляр — тот диск, куда её положили.
# На стенде это ещё и причина, по которой донорский php-бэкенд дожил до продакшена:
# он приехал копией папки и авто-выкаткой не снимается.
#
# ХОСТОВЫЙ СКРИПТ, как postgres-backup.sh: cron на VPS
#   10 2 * * * /opt/casino-platform/infra/scripts/house-backup.sh
# (02:10, чтобы не пересекаться с дампом базы в 02:00). На рабочей машине тот же
# скрипт запускается вручную и пишет в D:/backups/casino-house:
#   HOUSE_BACKUP_DIR=/d/backups/casino-house bash infra/scripts/house-backup.sh
#
# Отличия от дампа БД: файл бэкапа обязан быть НЕПУСТЫМ. Молча спакнуть удалённую
# или переименованную папку — это не «бэкап получился», это «бэкап перестал быть
# бэкапом», и заметят это только при восстановлении.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

HOUSE_DIR="$REPO_ROOT/apps/web/public/house"
BACKUP_DIR="${HOUSE_BACKUP_DIR:-/opt/casino-backups}"
# Ниже этого числа файлов считаем, что папка не полная: 11 слотов + Plinko + Aztec
# дают сотни файлов, и «бэкап» из 12 файлов = кто-то почистил папку или переехал путь.
MIN_FILES="${HOUSE_BACKUP_MIN_FILES:-100}"
RETENTION_DAYS="${HOUSE_BACKUP_RETENTION_DAYS:-14}"

if [ ! -d "$HOUSE_DIR" ]; then
  echo "HOUSE BACKUP FAILED: нет папки $HOUSE_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F_%H%M)
ARCHIVE="$BACKUP_DIR/house_$STAMP.tar.gz"
MANIFEST="$BACKUP_DIR/house_$STAMP.manifest.txt"

cd "$REPO_ROOT/apps/web/public"

FILE_COUNT=$(find house -type f | wc -l | tr -d ' ')
TOTAL_BYTES=$(find house -type f -printf '%s\n' | awk '{ sum += $1 } END { print sum + 0 }')

if [ "$FILE_COUNT" -lt "$MIN_FILES" ]; then
  echo "HOUSE BACKUP FAILED: файлов $FILE_COUNT, ожидалось не меньше $MIN_FILES — папка повреждена или путь переехал" >&2
  exit 1
fi

tar -czf "$ARCHIVE" house

# Проверка, а не вежливость: число записей в архиве обязано совпадать с числом
# файлов на диске, иначе tar что-то пропустил (права, длинный путь, битый том).
ARCHIVED=$(tar -tzf "$ARCHIVE" | grep -vc '/$' || true)
if [ "$ARCHIVED" -ne "$FILE_COUNT" ]; then
  echo "HOUSE BACKUP FAILED: на диске $FILE_COUNT файлов, в архиве $ARCHIVED" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

( cd "$BACKUP_DIR" && sha256sum "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256" )
( cd "$BACKUP_DIR" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null )

{
  echo "created:        $(date -Is)"
  echo "source:         apps/web/public/house"
  echo "files:          $FILE_COUNT"
  echo "bytes:          $TOTAL_BYTES"
  echo "archive:        $(basename "$ARCHIVE")"
  echo "sha256:         $(awk '{print $1}' "$ARCHIVE.sha256")"
  echo "games:"
  find house -mindepth 1 -maxdepth 1 -type d -printf '  %f\n' | sort
} > "$MANIFEST"

find "$BACKUP_DIR" -name 'house_*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'house_*.tar.gz.sha256' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'house_*.manifest.txt' -mtime +"$RETENTION_DAYS" -delete

echo "House backup OK $STAMP: $FILE_COUNT файлов, $TOTAL_BYTES байт → $(basename "$ARCHIVE")"
# Вторая копия вне этой машины (иначе потеря диска = потеря 11 игр из 13):
#   rclone copy "$BACKUP_DIR" s3remote:casino-backups/
