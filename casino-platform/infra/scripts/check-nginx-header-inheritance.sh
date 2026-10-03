#!/usr/bin/env bash
# Gate: location'ы с собственным add_header обязаны включать snippets/security-headers.conf.
#
# Почему это отдельная проверка, а не «видно на ревью»: в nginx add_header
# НАСЛЕДУЮТСЯ во вложенный блок ТОЛЬКО если в блоке нет ни одной своей add_header.
# Как только автор location добавляет безобидный `add_header Cache-Control`, ВСЕ
# security-заголовки родительского server'а (nosniff, Referrer-Policy, HSTS,
# X-XSS-Protection, X-Frame-Options) исчезают — конфиг валиден, nginx-т проходит,
# заголовок просто перестаёт уезжать. Так аватарки в /uploads/avatars/ остались
# без security-headers. Ловить это надо до мержа.
#
# Правило: в каждом location, где есть add_header, обязан быть и include общего
# сниппета. Server- и http-уровни не проверяем: там add_header и есть источник.
#
# Запуск: bash infra/scripts/check-nginx-header-inheritance.sh [путь-к-шаблону]
#   путь передаётся только для тестов проверки на синтетическом шаблоне;
#   в CI вызывается без аргументов.
# Выход:  0 — чисто, 1 — найден location без сниппета, 2 — сам скрипт не смог работать.
set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null)/casino-platform" 2>/dev/null ||
  cd "$(dirname "$0")/../.." || { echo "❌ GATE FAIL: казино-платформу не найдено"; exit 2; }

TEMPLATE=${1:-infra/nginx/templates/casino.conf.template}
SNIPPET=infra/nginx/snippets/security-headers.conf

[ -f "$TEMPLATE" ] || { echo "❌ GATE FAIL: $TEMPLATE не найден"; exit 2; }
[ -f "$SNIPPET" ] || { echo "❌ GATE FAIL: $SNIPPET не найден"; exit 2; }

# Блоки в nginx могут быть в одну строку (`location / { ... }`), поэтому парсер
# идёт посимвольно и отслеживает глубину скобок, а не «строку location».
VIOLATIONS=$(
  awk '
    BEGIN { inloc = 0; depth = 0; hasadd = 0; hasinc = 0; name = "" }
    {
      line = $0
      # Вход в location: помечаем имя и обнуляем счётчики этого блока.
      if (inloc == 0 && line ~ /^[[:space:]]*location[[:space:]]/) {
        inloc = 1; depth = 0; hasadd = 0; hasinc = 0
        name = line
        sub(/^[[:space:]]*/, "", name)
        sub(/[[:space:]]*\{.*/, "", name)
      }
      if (inloc == 1) {
        if (line ~ /add_header/) hasadd = 1
        if (line ~ /include[[:space:]]+\/etc\/nginx\/snippets\/security-headers\.conf/) hasinc = 1
        opens = gsub(/\{/, "{", line)
        closes = gsub(/\}/, "}", line)
        depth += opens - closes
        if (depth <= 0) {
          if (hasadd && !hasinc) printf "   %s\n", name
          inloc = 0
        }
      }
    }
  ' "$TEMPLATE"
)

if [ -n "$VIOLATIONS" ]; then
  echo ""
  echo "❌ nginx-заголовки теряются по наследованию (add_header в location без сниппета):"
  printf '%s\n' "$VIOLATIONS"
  echo ""
  echo "   Добавь в этот location:"
  echo "     include /etc/nginx/snippets/security-headers.conf;"
  echo "   (и, если нужно, свой X-Frame-Options — его в сниппете нет намеренно)"
  echo ""
  exit 1
fi

echo "✅ nginx security-headers: каждый location со своим add_header включает сниппет"
