#!/usr/bin/env bash
set -e

# Configuration
DB_CONTAINER="casino-db"
DB_USER="postgres"
DB_NAME="casino"
BACKUP_DIR="/var/backups/casino"

# Check if backup file is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  echo "Available backups in $BACKUP_DIR:"
  ls -lh $BACKUP_DIR
  exit 1
fi

BACKUP_FILE=$1

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: File $BACKUP_FILE not found."
  exit 1
fi

echo "Warning: This will overwrite the current database ($DB_NAME)."
read -p "Are you sure? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  exit 1
fi

echo "Restoring database from $BACKUP_FILE..."

# Stop the API to prevent writes during restore
docker-compose stop api

# Drop and recreate DB (requires superuser, adjust if necessary)
docker exec $DB_CONTAINER psql -U $DB_USER -c "DROP DATABASE IF EXISTS $DB_NAME (FORCE);"
docker exec $DB_CONTAINER psql -U $DB_USER -c "CREATE DATABASE $DB_NAME;"

# Restore
gunzip -c "$BACKUP_FILE" | docker exec -i $DB_CONTAINER psql -U $DB_USER -d $DB_NAME

echo "Applying migrations..."
pnpm db:deploy

echo "Starting API..."
docker-compose start api

echo "Restore complete."
