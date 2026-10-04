#!/bin/sh
# G7 — денежный инвариант кошелька (wallet money transaction invariant).
#
# ПЕРЕПИСАН 2026-10-03. Прежняя версия гарда была вакуумной (GAP-57):
#   FILE=.../wallet.ledger.prisma.ts
#   if [ -f "$FILE" ]; then TXNS=$(grep -c 'prisma\.\$transaction' ...); fi
# — вызовов `$transaction` в этом файле 0, поэтому `TXNS > SERIALS` не
# выполнялось НИ при каком положении дел, а `if [ -f ]` молча пропускал
# гард дальше при удалении/переименовании файла. Гард был зелёным, ничего
# не проверяя, и требовал `Serializable`, от которого ADR GAP-57 осознанно
# отказался (шапка wallet-transaction-lock.ts:11-30: SSI давал P2034, 69%
# ставок отбивались при 100 VU).
#
# Нынешний инвариант — НЕ «каждый $transaction = Serializable», а
# «денежная операция кошелька идёт только через примитиву runWalletTransaction,
# которая (а) берёт pg_advisory_xact_lock ДО первого чтения, (б) работает на
# ReadCommitted, (в) повторяет при конфликте».
#
# АНТИ-ВАКУУМ (требование к каждому гарду, docs/QUALITY_GATES.md §3.6):
#  - отсутствует проверяемый файл/корень  → FAIL (не skip);
#  - обязательного совпадения должно быть РОВНО N, меньше → FAIL;
#  - каждый проверенный инвариант печатается в лог, в конце — их число:
#    «зелёный» гард обязан показать, ЧТО он проверил.
#
# Запуск:
#   sh scripts/check-wallet-money-invariant.sh            # рабочее дерево
#   sh scripts/check-wallet-money-invariant.sh <корень>    # копия дерева (selftest)
# Выход: 0 — инвариант держится, 1 — нарушен (или нечего проверять).

set -u

P="${1:-}"
[ -n "$P" ] && P="${P%/}/"
SRC="${P}apps/api/src"

LEDGER_DIR="${SRC}/modules/wallet/infrastructure/ledger"
LOCK="${LEDGER_DIR}/wallet-transaction-lock.ts"
LEDGER="${LEDGER_DIR}/wallet.ledger.prisma.ts"
RUNNER="${LEDGER_DIR}/wallet-transaction-runner.prisma.ts"

FAIL=0
CHECKS=0

fail() {
  echo "❌ G7 FAIL: $*"
  FAIL=1
}

ok() {
  CHECKS=$((CHECKS + 1))
  echo "   ok $CHECKS. $*"
}

# grep -c на отсутствующем файле/пустом совпадении не должен ронять скрипт.
count() {
  grep -cE "$2" "$1" 2>/dev/null || true
}

# Первая строка совпадения (0 = совпадений нет).
first_line() {
  grep -nE "$2" "$1" 2>/dev/null | head -1 | cut -d: -f1 || true
}

# ── 0. Нечего проверять — уже отказ (главный урок G7) ────────────────────
if [ ! -d "${SRC}/modules/wallet" ]; then
  echo "❌ G7 FAIL: нет '${SRC}/modules/wallet' — гард не может молча пропуститься."
  exit 1
fi
for f in "$LOCK" "$LEDGER" "$RUNNER"; do
  if [ ! -f "$f" ]; then
    fail "нет файла примитивы леджера: $f (переименован/удалён — обнови гард ОСОЗНАННО)"
  fi
done
if [ "$FAIL" = 1 ]; then
  echo "   Инвариант: деньги кошелька мутирует только связка lock+ledger+runner."
  exit 1
fi
ok "все три файла примитивы на месте"

# ── 1. Примитива берёт advisory-лок ──────────────────────────────────────
N=$(count "$LOCK" 'pg_advisory_xact_lock')
N=${N:-0}
if [ "$N" -ge 1 ]; then
  ok "примитива берёт pg_advisory_xact_lock ($N)"
else
  fail "в $LOCK нет pg_advisory_xact_lock — сериализация кошелька потеряна (GAP-57)"
fi

# ── 2. Уровень изоляции — ровно один, ReadCommitted (ADR GAP-57) ─────────
N=$(count "$LOCK" "isolationLevel[[:space:]]*:[[:space:]]*['\"]ReadCommitted['\"]")
N=${N:-0}
if [ "$N" = 1 ]; then
  ok "изоляция ReadCommitted, ровно одна транзакция примитивы ($N)"
else
  fail "ожидался РОВНО 1 вызов с isolationLevel: 'ReadCommitted' в $LOCK, найдено $N"
fi
N=$(count "$LOCK" 'isolationLevel')
N=${N:-0}
if [ "$N" = 1 ]; then
  ok "внутри примитивы больше нет второго isolationLevel"
else
  fail "в $LOCK $N упоминаний isolationLevel — второй уровень изоляции заведётся молча"
fi
N=$(count "$LOCK" "isolationLevel[[:space:]]*:[[:space:]]*['\"]Serializable['\"]")
N=${N:-0}
if [ "$N" = 0 ]; then
  ok "Serializable возвращён быть не может (решение GAP-57)"
else
  fail "в $LOCK снова появился isolationLevel: 'Serializable' — это откат GAP-57 (P2034, 69% отказов ставок)"
fi

# ── 3. Повтор при конфликте ──────────────────────────────────────────────
ATTEMPTS=$(grep -oE 'MAX_ATTEMPTS[[:space:]]*=[[:space:]]*[0-9]+' "$LOCK" 2>/dev/null |
  grep -oE '[0-9]+$' | head -1 || true)
LOOP=$(count "$LOCK" 'attempt[[:space:]]*<=?[[:space:]]*MAX_ATTEMPTS')
LOOP=${LOOP:-0}
RETRY=$(count "$LOCK" 'isRetryableConflict')
RETRY=${RETRY:-0}
if [ -n "$ATTEMPTS" ] && [ "$ATTEMPTS" -ge 2 ] && [ "$LOOP" -ge 1 ] && [ "$RETRY" -ge 2 ]; then
  ok "повтор при конфликте: MAX_ATTEMPTS=$ATTEMPTS, цикл $LOOP, isRetryableConflict $RETRY"
else
  fail "примитива не повторяет при конфликте: MAX_ATTEMPTS='${ATTEMPTS:-нет}' (нужно >=2), цикл=$LOOP (нужен >=1), isRetryableConflict=$RETRY (нужно >=2: проверка + вызов)"
fi

# ── 4. Лок берётся ДО первого чтения (главное условие корректности) ──────
# Шаблоны ловят ВЫЗОВИ, а не определения: `acquireWalletLock(tx, target)` и
# `body(tx)` внутри колбэка $transaction (определения — `tx:` и `body: (tx:`).
LOCK_LINE=$(first_line "$LOCK" 'acquireWalletLock[[:space:]]*\([[:space:]]*tx[[:space:]]*,')
BODY_LINE=$(first_line "$LOCK" 'body[[:space:]]*\([[:space:]]*tx[[:space:]]*\)')
if [ -n "$LOCK_LINE" ] && [ -n "$BODY_LINE" ] && [ "$LOCK_LINE" -lt "$BODY_LINE" ]; then
  ok "acquireWalletLock (стр.$LOCK_LINE) предшествует body(tx) (стр.$BODY_LINE)"
else
  fail "порядок нарушен: acquireWalletLock=${LOCK_LINE:-нет}, body(tx)=${BODY_LINE:-нет} — чтение баланса до лока читает устаревшие деньги"
fi

# ── 5. Ledger и runner ходят ЧЕРЕЗ примитиву ─────────────────────────────
for f in "$LEDGER" "$RUNNER"; do
  N=$(count "$f" 'runWalletTransaction[[:space:]]*\(')
  N=${N:-0}
  if [ "$N" -ge 1 ]; then
    ok "$(basename "$f"): вызывает runWalletTransaction ($N)"
  else
    fail "$f не вызывает runWalletTransaction — денежная транзакция открыта в обход примитивы"
  fi
done

# ── 6. Ledger не открывает СВОЮ транзакцию и не мутирует кошелёк вне tx ──
N=$(count "$LEDGER" 'prisma\.[[:space:]]*\$transaction[[:space:]]*\(')
N=${N:-0}
if [ "$N" = 0 ]; then
  ok "в леджере нет собственного prisma.\$transaction"
else
  fail "в $LEDGER $N вызовов prisma.\$transaction — money-мутация вне примитивы (GAP-57)"
fi
N=$(count "$LEDGER" 'prisma\.(walletAccount|ledgerEntry)[[:space:]]*\.(create|createMany|update|updateMany|delete|deleteMany|upsert)[[:space:]]*\(')
N=${N:-0}
if [ "$N" = 0 ]; then
  ok "кошелёк/леджер не пишутся через глобальный клиент prisma.*"
else
  fail "в $LEDGER $N записей в walletAccount/ledgerEntry через глобальный prisma-клиент (вне tx примитивы)"
fi
N=$(count "$LEDGER" 'tx\.(walletAccount|ledgerEntry)[[:space:]]*\.(create|createMany|update|updateMany)[[:space:]]*\(')
N=${N:-0}
if [ "$N" -ge 1 ]; then
  ok "мутации идут через клиент транзакции tx.* ($N мест)"
else
  fail "в $LEDGER нет ни одной мутации через tx.* — детектор слеп (анти-вакуум)"
fi

# ── 7. isolationLevel не встречается больше нигде в src ──────────────────
TX_FILES=$(grep -rlE 'isolationLevel' "$SRC" --include='*.ts' 2>/dev/null |
  sed 's|\\|/|g' | sort || true)
NF=$(printf '%s\n' "$TX_FILES" | grep -c . || true)
NF=${NF:-0}
if [ "$NF" = 1 ] && [ "$TX_FILES" = "$LOCK" ]; then
  ok "isolationLevel живёт ровно в одном файле src — в самой примитиве"
else
  fail "isolationLevel найден в $NF файлах src (ожидался ровно 1 — $LOCK):"
  printf '%s\n' "$TX_FILES" | sed 's/^/     /'
fi

if [ "$FAIL" = 1 ]; then
  echo "   См. ADR GAP-57 (шапка $LOCK:11-30) и docs/QUALITY_GATES.md §3.2 (строка G7)."
  echo "   Проверено инвариантов до отказа: $CHECKS."
  exit 1
fi
echo "✅ G7 OK ($CHECKS инвариантов): деньги кошелька — только через runWalletTransaction"
echo "   (advisory-лок до первого чтения + ReadCommitted + повтор при конфликте)."
exit 0
