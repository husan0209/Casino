#!/bin/sh
# Pre-flight агента в общем рабочем дереве. POSIX sh, вызывается так:
#
#   sh scripts/agent-preflight.sh status            # что происходит в дереве прямо сейчас
#   sh scripts/agent-preflight.sh claim <имя> [порты]  # заявить дерево за собой
#   sh scripts/agent-preflight.sh release [<имя>]   # отпустить лок
#
# Зачем. В репозитории работают несколько агентов в ОДНОЙ папке (D:/projects/Casino).
# Дерево одно, значит `git switch` одного агента меняет исходники под носом у другого,
# а второй `next dev` с общим .next лишает первого манифеста маршрутов. Оба случая
# уже случались. Локи и реестр портов описаны в docs/CONVENTIONS.md §10.5.
#
# Лок — файл, а не git-состояние: он переживает чужие checkout-ы и не попадает в индекс.
# Ограничение по природе: это договорённость, а не защита. Агент, который не стал читать
# лок, всё равно сделает что хочет — но конфликт он увидит в выводе `status`.

set -u

LOCK_DIR="${TEMP:-${TMPDIR:-/tmp}}"
LOCK="$LOCK_DIR/casino-agent.lock"
PORTS_REGISTRY='3000/3001/3002 общий dev-кластер | 3005 QA-съёмка | 3010-3019 персональные серверы агентов | 3012 mock-api QA | 3101 запасной api'

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "agent-preflight: мы вне git-репозитория" >&2
  exit 2
}
PLAT="$ROOT/casino-platform"

now() { date '+%Y-%m-%d %H:%M:%S'; }
epoch() { date '+%s'; }

# TTL по умолчанию: 90 минут. Агент продлевает его командой `renew`.
TTL_MIN=${AGENT_LOCK_TTL_MIN:-90}

pid_alive() {
  # Windows: tasklist видит PID надёжнее, чем MSYS kill. Fallback — kill -0.
  p=${1:-}
  [ -n "$p" ] || return 1
  if command -v tasklist >/dev/null 2>&1; then
    MSYS_NO_PATHCONV=1 tasklist /FI "PID eq $p" 2>/dev/null | grep -qE "[[:space:]]$p[[:space:]]" && return 0
    return 1
  fi
  kill -0 "$p" 2>/dev/null
}

lock_field() { sed -n "s/^$1=//p" "$LOCK" 2>/dev/null | head -1; }

# Жив ли лок. PID здесь НЕ надёжен: агенты в Cline/Kilo вызывают каждый шаг новым
# процессом, и pid скрипта умирает сразу. Поэтому решение по свежести (updated + TTL),
# а живой pid — только дополнительное подтверждение «точно занят».
lock_held() {
  [ -f "$LOCK" ] || return 1
  up=$(lock_field updated)
  [ -n "$up" ] || up=$(lock_field since)
  if [ -z "$up" ]; then return 0; fi
  age=$(( $(epoch) - up ))
  if [ "$age" -lt $(( TTL_MIN * 60 )) ]; then return 0; fi
  pid_alive "$(lock_field pid)" && return 0
  return 1
}

lock_reason() {
  up=$(lock_field updated); [ -n "$up" ] || up=$(lock_field since)
  age=$(( $(epoch) - ${up:-0} ))
  echo "владелец=$(lock_field agent) держит $(( age / 60 )) мин из ${TTL_MIN} (pid=$(lock_field pid))"
}

listening() {
  if command -v netstat >/dev/null 2>&1; then
    MSYS_NO_PATHCONV=1 netstat -ano -p tcp 2>/dev/null | grep LISTENING \
      | grep -oE ':30[0-9]{2} .*[0-9]+$' | awk '{print $1 " pid=" $NF}' | sort -u
  fi
}

tree_state() {
  echo "дерево:   $ROOT"
  echo "ветка:    $(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'н/д')"
  echo "HEAD:     $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'н/д')"
  behind=$(git -C "$ROOT" rev-list --count HEAD..origin/main 2>/dev/null || echo '?')
  ahead=$(git -C "$ROOT" rev-list --count origin/main..HEAD 2>/dev/null || echo '?')
  echo "origin/main: позади=$behind впереди=$ahead"
  dirty=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "грязных записей: $dirty  (если >0 — в общем дереве чужая незакоммиченная работа)"
  echo "деревьев git:    $(git -C "$ROOT" worktree list 2>/dev/null | wc -l | tr -d ' ')"
}

cmd_status() {
  echo "=== agent-preflight status @ $(now) ==="
  tree_state
  echo ""
  echo "--- лок: $LOCK (TTL ${TTL_MIN} мин)"
  if [ -f "$LOCK" ]; then
    sed 's/^/    /' "$LOCK"
    if lock_held; then
      echo "    СОСТОЯНИЕ: занят — $(lock_reason)"
    else
      echo "    СОСТОЯНИЕ: устарел ($(lock_reason)) — можно перезаявить"
    fi
  else
    echo "    свободен"
  fi
  echo ""
  echo "--- реестр портов: $PORTS_REGISTRY"
  echo "--- слушатели 30xx:"
  listening | sed 's/^/    /' || true
}

cmd_claim() {
  agent=${1:-}
  ports=${2:-}
  if [ -z "$agent" ]; then
    echo "использование: sh scripts/agent-preflight.sh claim <имя-агента> [порты]" >&2
    exit 2
  fi
  if lock_held; then
    lagent=$(lock_field agent)
    if [ "$lagent" != "$agent" ]; then
      echo "ОТКАЗ: дерево занято агентом '$lagent'." >&2
      echo "    $(lock_reason)" >&2
      sed 's/^/    /' "$LOCK" >&2
      echo "" >&2
      echo "По CONVENTIONS §10.5: не делай git switch в этой папке без слова владельца" >&2
      echo "и не занимай его порты. Если владелец завершился — дождись истечения TTL" >&2
      echo "(${TTL_MIN} мин) или попроси его: sh scripts/agent-preflight.sh release $lagent" >&2
      echo "Явное переопределение (только по слову владельца): FORCE_CLAIM=1" >&2
      [ "${FORCE_CLAIM:-}" = "1" ] || exit 1
      echo "⚠️  FORCE_CLAIM=1 — переопределяю лок, занятый '$lagent'" >&2
    fi
  fi
  tmp="$LOCK.$$"
  {
    echo "agent=$agent"
    echo "pid=$$"
    echo "branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    echo "ports=$ports"
    echo "since=$(epoch)"
    echo "since_human=$(now)"
    echo "updated=$(epoch)"
    echo "ttl_min=$TTL_MIN"
    echo "tree=$ROOT"
  } >"$tmp" && mv "$tmp" "$LOCK"
  echo "лок заявлен: $agent (порты=${ports:-не указаны}, TTL ${TTL_MIN} мин) -> $LOCK"
}

cmd_renew() {
  [ -f "$LOCK" ] || { echo "лока нет — сначала claim" >&2; exit 1; }
  who=${1:-$(lock_field agent)}
  [ "$(lock_field agent)" = "$who" ] || { echo "ОТКАЗ: лок принадлежит '$(lock_field agent)', не '$who'" >&2; exit 1; }
  tmp="$LOCK.$$"
  sed "s/^updated=.*/updated=$(epoch)/" "$LOCK" >"$tmp" && mv "$tmp" "$LOCK"
  echo "продлён на ${TTL_MIN} мин: $who"
}

cmd_release() {
  who=${1:-}
  [ -f "$LOCK" ] || { echo "лока нет"; exit 0; }
  lagent=$(lock_field agent)
  if [ -n "$who" ] && [ "$who" != "$lagent" ]; then
    echo "ОТКАЗ: лок принадлежит '$lagent', не '$who'" >&2
    exit 1
  fi
  rm -f "$LOCK"
  echo "лок снят (был: ${lagent:-?})"
}

case ${1:-status} in
  status)  cmd_status ;;
  claim)   shift; cmd_claim "${1:-}" "${2:-}" ;;
  renew)   shift; cmd_renew "${1:-}" ;;
  release) shift; cmd_release "${1:-}" ;;
  *)
    echo "использование: sh scripts/agent-preflight.sh {status|claim <агент> [порты]|renew [<агент>]|release [<агент>]}" >&2
    exit 2
    ;;
esac
