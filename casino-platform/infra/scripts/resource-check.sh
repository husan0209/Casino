#!/bin/bash
# ТЗ ч.7 §12.3: контроль ресурсов VPS (GAP-37).
# Cron: */5 * * * * /opt/casino-platform/infra/scripts/resource-check.sh
# ALERT'ы печатаются в stdout (Journald при cron); пороги из ТЗ: CPU 85%, RAM 90%, disk 85%.

CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 | cut -d',' -f1)
RAM_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | cut -d'%' -f1)

if [ "${CPU_USAGE%%.*}" -gt 85 ]; then
    echo "ALERT: High CPU usage: ${CPU_USAGE}%"
fi

if [ "$RAM_USAGE" -gt 90 ]; then
    echo "ALERT: High RAM usage: ${RAM_USAGE}%"
fi

if [ "$DISK_USAGE" -gt 85 ]; then
    echo "ALERT: High disk usage: ${DISK_USAGE}%"
fi

# Состояние стеков и readiness. GAP-56: порт api не публикуется на хост — прежний
# curl http://localhost:3001 с хоста падал всегда; проба выполняется изнутри
# контейнера api (wget есть в образе). /health/ready отдаёт 200 при живой БД
# (degraded:true при недоступном Redis — это норма, GAP-35) и 503 при падении БД.
if command -v docker >/dev/null 2>&1; then
    docker ps --format '{{.Names}}: {{.Status}}' | grep -E 'casino|api|web|admin' || true
    REPO_ROOT="$(cd "$(dirname "$0")" && pwd)/../.."
    if docker compose -f "$REPO_ROOT/docker-compose.prod.yml" exec -T api \
        wget -qO- http://localhost:3001/api/v1/health/ready 2>/dev/null | grep -q '"status":"ok"'; then
        echo "API /health/ready: OK"
    else
        echo "ALERT: API /health/ready недоступен"
    fi
fi

exit 0
