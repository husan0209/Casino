#!/bin/sh
# G23 — NEXT_PUBLIC_* обязаны доехать до прод-сборки через build.args.
#
# Зачем: Next.js инлайнит process.env.NEXT_PUBLIC_* в клиентский бандл НА СТАДИИ
# СБОРКИ (текстовая замена литералом). env_file сервиса на сборку не влияет —
# Compose-доки: «variables defined in environment files will not be automatically
# visible during the build. Use the args sub-option of build». Если prod-Dockerfile
# объявляет `ARG NEXT_PUBLIC_X=default`, а compose не передаёт X в build.args —
# в образ уезжает default, и на реальном домене фронт ходит на чужой хост.
#
# История: GAP-59 — web получал build-arg NEXT_PUBLIC_API_URL, admin нет; бандл
# админки запекал `https://casino.example.com/api/v1` (vhost admin в nginx без
# location /api/ → абсолютный URL обязателен). CI не ловил, потому что job
# docker-build собирает только api.prod.
#
# Запуск:  sh scripts/check-prod-build-args.sh
# Выход:   0 — чисто, 1 — найдены ARG без build-arg в compose.
set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null)/casino-platform" 2>/dev/null ||
  cd "$(dirname "$0")/../.."

COMPOSE=docker-compose.prod.yml
[ -f "$COMPOSE" ] || { echo "❌ G23 FAIL: $COMPOSE не найден"; exit 1; }

# Секция build: сервиса — от 'build:' до строки с меньшим/равным отступом ключа.
# Для каждого сервиса запоминаем его dockerfile и список переданных args.
build_section() {
  awk -v svc="$1" '
    $0 ~ "^  "svc":" {insvc=1}
    insvc && /^  [a-zA-Z]/ && $0 !~ "^  "svc":" {insvc=0}
    insvc && /^    build:/ {inbuild=1; next}
    inbuild && /^    [a-zA-Z]/ && !/^    build:/ {inbuild=0}
    inbuild {print}
  ' "$COMPOSE"
}

FAIL=0
for DF in infra/docker/*.prod.Dockerfile; do
  [ -f "$DF" ] || continue
  # ARG'и, объявленные в проде (кроме служебных, начинающихся с '_').
  # `|| true` — у api.prod.Dockerfile ARG'ов нет вовсе, и grep вернёт 1; без этого
  # под `bash -e` (флаги runner'а) присваивание уронило бы скрипт до вывода ❌ —
  # ровно как errexit-баг D7 в docs-guard (GAP-41).
  ARGS=$(grep -oE '^ARG[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' "$DF" |
    awk '{print $2}' | grep -v '^_' | sort -u || true)
  [ -n "$ARGS" ] || continue

  # Какой сервис собирается из этого Dockerfile (40 строк выше — с запасом)
  SVC=$(grep -B40 "dockerfile: $DF\$" "$COMPOSE" | grep -oE '^  [a-z0-9_-]+:' |
    tail -1 | tr -d ' :' || true)
  if [ -z "$SVC" ]; then
    echo "❌ G23 FAIL: $DF не используется ни одним сервисом $COMPOSE"
    FAIL=1
    continue
  fi

  # list-формат: '- NAME=value'; map-формат: 'NAME: value'
  PASSED=$(build_section "$SVC" | grep -oE '^[[:space:]]*-?[[:space:]]*[A-Za-z_][A-Za-z0-9_]*' |
    awk '{print $NF}' | sort -u || true)
  PASSED_MAP=$(build_section "$SVC" | grep -oE '^[[:space:]]+[A-Za-z_][A-Za-z0-9_]*:' |
    tr -d ' :' | sort -u || true)

  for A in $ARGS; do
    if ! echo "$PASSED" | grep -qx "$A" && ! echo "$PASSED_MAP" | grep -qx "$A"; then
      echo "❌ G23 FAIL: $DF объявляет ARG $A, но сервис '$SVC' в $COMPOSE"
      echo "           не передаёт его в build.args → в образ уедет ARG-дефолт."
      echo "           NEXT_PUBLIC_* инлайнятся в бандл на сборке (env_file не помогает)."
      FAIL=1
    fi
  done
done

[ "$FAIL" -eq 0 ] && echo "✅ G23 OK (все NEXT_PUBLIC_/ARG прод-Dockerfile'ов переданы через build.args)"
exit $FAIL
