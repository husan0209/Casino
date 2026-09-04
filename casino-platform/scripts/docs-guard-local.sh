#!/bin/sh
# Локальный прогон docs-guard (D1–D7) — то же тело шага, что исполняет CI.
#
# Зачем: спека чеков живёт в .github/workflows/docs-guard.yml (корень репо), а
# локальный запуск должен быть с НИМИ ЖЕ флагами, что у GitHub runner'а:
#   bash --noprofile --norc -e -o pipefail
# Ручная копия тела шага (лежала в $HOME/dg.sh) расходилась с CI и запускалась
# без -e, из-за чего errexit-баг D7 (GAP-41) прошёл локально зелёным и упал в CI.
#
# Запуск из casino-platform/:   sh scripts/docs-guard-local.sh
# или (тонкий указатель, который кладёт в $HOME установка окружения):  sh ~/dg.sh
set -u

# workflow лежит в корне репо (GitHub Actions читает только .github/ в корне),
# поэтому ищем его от корня git, а не от CWD — работает и в worktree.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "docs-guard-local: это не git-дерево" >&2; exit 2
}
WF="$ROOT/.github/workflows/docs-guard.yml"
[ -f "$WF" ] || { echo "docs-guard-local: $WF не найден" >&2; exit 2; }

# Работать надо из casino-platform/ — чеки ходят относительными путями
if [ ! -f .env.example ] || [ ! -d docs ]; then
  echo "docs-guard-local: запускай из каталога casino-platform/ (нет .env.example или docs/)" >&2
  exit 2
fi

TMP=$(mktemp) || { echo "docs-guard-local: mktemp не удался" >&2; exit 2; }
trap 'rm -f "$TMP"' EXIT INT TERM

# Тело шага: от `run: |` до следующего ключа job'а, сняв отступ в 10 пробелов
awk '/run: \|/{f=1;next} /^  [a-z]/{f=0} f' "$WF" | sed 's/^          //' > "$TMP"
[ -s "$TMP" ] || { echo "docs-guard-local: не удалось извлечь тело run: из $WF" >&2; exit 2; }

echo "docs-guard-local: чеки взяты из ${WF#"$ROOT"/}, флаги как у runner'а (-e -o pipefail)"
exec bash -e -o pipefail "$TMP"
