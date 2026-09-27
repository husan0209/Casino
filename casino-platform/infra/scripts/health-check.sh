#!/usr/bin/env bash
set -e

# GAP-56: порт api не публикуется на хост (наружу только nginx 80/443) — прежний
# curl http://localhost:3001 с хоста падал всегда. Проба выполняется изнутри
# контейнера api (wget есть в образе — им же работает healthcheck compose).

MAX_ATTEMPTS=5
SLEEP_TIME=5
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)/../.."
cd "$REPO_ROOT"
compose() { docker compose -f docker-compose.prod.yml "$@"; }

echo "Checking health (inside api container)..."

for (( i=1; i<=$MAX_ATTEMPTS; i++ ))
do
  RESPONSE=$(compose exec -T api wget -qO- http://localhost:3001/api/v1/health 2>/dev/null || true)
  if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    echo "Health check passed!"
    echo "Database is connected."
    exit 0
  fi

  echo "Attempt $i failed. Retrying in $SLEEP_TIME seconds..."
  sleep $SLEEP_TIME
done

echo "Health check failed after $MAX_ATTEMPTS attempts."
exit 1
