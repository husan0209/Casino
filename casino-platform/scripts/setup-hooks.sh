#!/bin/sh
# ────────────────────────────────────────────────────────────────
# casino-platform/scripts/setup-hooks.sh
#
# Настройка git-хуков для монорепо, где git-корень НЕ совпадает
# с package.json (casino-platform/).
#
# Запускать после clone / pull:
#   sh scripts/setup-hooks.sh
#
# Если файловая система не поддерживает exec-бит (FAT/sdcard),
# создаёт исполняемые обёртки в $HOME/.casino-git-hooks,
# которые запускают реальные хуки через sh.
# ────────────────────────────────────────────────────────────────
set -e

ROOT="$(git rev-parse --show-toplevel)"
PLAT="$ROOT/casino-platform"
HOOKDIR_REL="casino-platform/.husky"

chmod +x "$PLAT/.husky/"* 2>/dev/null || true

if [ -x "$PLAT/.husky/pre-commit" ]; then
  # Обычная ФС — хуки напрямую
  git config core.hooksPath "$HOOKDIR_REL"
  echo "core.hooksPath => $HOOKDIR_REL"
else
  # FAT/sdcard (noexec) — обёртки в домашней папке
  WRAP="$HOME/.casino-git-hooks"
  mkdir -p "$WRAP"
  for h in pre-commit commit-msg pre-push; do
    printf '#!/bin/sh\nexec sh "%s/.husky/%s" "$@"\n' "$PLAT" "$h" > "$WRAP/$h"
    chmod +x "$WRAP/$h"
  done
  git config core.hooksPath "$WRAP"
  echo "core.hooksPath => $WRAP (sh-wrappers for noexec fs)"
fi

[ -f "$PLAT/scripts/bin/eslint" ] && echo "scripts/bin shims OK"
