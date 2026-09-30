import { prisma } from '@casino/database'

import { OptimisticLockError } from '../../domain/errors'
import { type WalletLockTarget } from '../../domain/repositories/wallet.repository'

import type { Prisma } from '@prisma/client'

/**
 * GAP-57: сериализация конкурентных мутаций одного кошелька.
 *
 * Что было: bet/win/rollback открывали ОДНУ Serializable-транзакцию на весь
 * колбэк. При профиле казино «много ставок в секунду на одного игрока» все
 * транзакции читали и писали одну строку `wallet_accounts`, SSI Postgres
 * откатывал их на коммите (SQLSTATE 40001 → Prisma P2034), и 3 ретрая
 * без джиттера давали 69% отказов при 100 VU (прогон GAP-47, 2026-09-27).
 *
 * Что стало: вместо конкурентного abort-повтора — явная очередь. Транзакция
 * берёт `pg_advisory_xact_lock` на ключ кошелька ДО первого чтения, поэтому
 * мутации одного кошелька идут строго по очереди, а не откатываются и
 * повторяются. Разные кошельки не блокируют друг друга (ключ по userId+currency).
 *
 * Почему ReadCommitted, а не Serializable: advisory-лок СЕРИАЛИЗУЕТ доступ к
 * кошельку, поэтому SSI-механизм (поиск опасных структур, abort на 40001)
 * больше не нужен и только мешает — он отменял бы в том числе транзакции,
 * не конфликтующие по деньгам. Смена уровня изоляции безопасна именно в связке
 * с локом: без лока ReadCommitted ослабил бы инвариант (проигравший прочитал бы
 * устаревший balance).
 *
 * Инварианты, которые лок НЕ ослабляет:
 *  - `pg_advisory_xact_lock` освобождается СУБД автоматически на commit/rollback
 *    (в т.ч. при обрыве соединения) — «залипший» лок невозможен;
 *  - проверка `version` (optimistic lock) в ledger остаётся как второй рубеж:
 *    лок защищает кошелёк, версия защищает от любой будущей мутации в обход лока;
 *  - lock_timeout ограничивает ожидание, чтобы всплеск на одном кошельке не
 *    выел весь пул соединений и не заблокировал API для других игроков.
 *
 * Много кошельков в одной транзакции: локи берутся в переданном вызывающим
 * порядке. Сегодня все денежные транзакции работают с ОДНИМ кошельком
 * (сессия игрока = userId + currency), поэтому взаимного порядка нет и
 * взаимоблокировки быть не может. Если появится транзакция с двумя
 * кошельками — ключи нужно брать в детерминированном (напр. сортированном)
 * порядке, иначе возможен deadlock.
 */

/** Ключ advisory-лока: кошелёк игрока в одной валюте (тип — в domain). */

/**
 * Префикс namespace: advisory-локи глобальны для кластера БД, поэтому ключ
 * должен быть однозначным и не пересекаться с будущими lock'ами других
 * подсистем (пересчёт GGR, реферальные начисления и т.п.).
 */
const LOCK_KEY_PREFIX = 'casino.wallet:'

/** Prisma P2034 — write conflict / serialization failure на уровне СУБД. */
const PRISMA_SERIALIZATION_FAILURE = 'P2034'
/** SQLSTATE 55P03 — не дождались advisory-лока за lock_timeout. */
const PG_LOCK_NOT_AVAILABLE = '55P03'

/**
 * Попыток на транзакцию. С advisory-локом повторы нужны редко (P2034/deadlock),
 * но остаются страховкой: тело транзакции идемпотентно по внешним ключам.
 */
const MAX_ATTEMPTS = 5
const BACKOFF_BASE_MS = 25

/**
 * Потолок ожидания advisory-лока. Без него 100 параллельных ставок на один
 * кошелёк держали бы ВЕСЬ пул соединений (Prisma ждёт соединение), и API
 * перестал бы обслуживать других игроков. По истечении — повтор с backoff,
 * затем WalletBusyError (503), а не висящий запрос.
 */
function lockTimeoutMs(): number {
  const raw = process.env['WALLET_LOCK_TIMEOUT_MS']
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000
}

/** Jitter — без него повторы образуют «волны» (отмечено в отчёте GAP-47). */
function backoffMs(attempt: number): number {
  return BACKOFF_BASE_MS * attempt * attempt * (0.5 + Math.random())
}

function errorCode(error: unknown): string | undefined {
  const direct = (error as { code?: unknown } | null)?.code
  if (typeof direct === 'string') {
    return direct
  }
  const meta = (error as { meta?: { code?: unknown } } | null)?.meta?.code
  return typeof meta === 'string' ? meta : undefined
}

/**
 * P2034 (write conflict) и 55P03 (lock timeout) — оба лечатся повтором.
 *
 * OptimisticLockError тоже повторяется: advisory-лок закрывает гонку заранее,
 * но проверка `version` в ledger остаётся вторым рубежом (G1-инвариант
 * «optimistic locking + retry ×3» из AI_DEVELOPMENT_RULES §7). Если какая-то
 * будущая мутация пройдёт в обход лока, конфликт версии не должен прилетать
 * к игроку ошибкой — он обязан быть прозрачным повтором.
 */
function isRetryableConflict(error: unknown): boolean {
  if (error instanceof OptimisticLockError) {
    return true
  }
  const code = errorCode(error)
  return code === PRISMA_SERIALIZATION_FAILURE || code === PG_LOCK_NOT_AVAILABLE
}

/**
 * Взять advisory-лок на кошелёк внутри уже открытой транзакции.
 * Первый вызов в транзакции должен ПРЕДШЕСТВОВАТЬ чтению `wallet_accounts`
 * (см. примитиву runWalletTransaction — он делает именно это).
 */
async function acquireWalletLock(tx: Prisma.TransactionClient, target: WalletLockTarget): Promise<void> {
  // Оба запроса параметризованы тегом Prisma ($queryRaw), а не склейкой строк:
  // userId/currency приходят из внешнего колбэка провайдера, и «Unsafe»-вариант
  // был бы вектором SQL-инъекции. set_config('lock_timeout', …, true) —
  // эквивалент SET LOCAL, но принимает bind-параметр (проверено на PG 16).
  const timeout = String(lockTimeoutMs())
  const lockKey = `${LOCK_KEY_PREFIX}${target.userId}:${target.currency}`
  // set_config с is_local=true действует только до конца транзакции — глобальный
  // lock_timeout трогать нельзя, он влиял бы на пул целиком.
  await tx.$queryRaw`SELECT set_config('lock_timeout', ${timeout}, true)`
  // hashtextextended — 64-битный хеш строки (PostgreSQL 11+); вернул bigint.
  //
  // ВАЖНО (поймано интеграционным тестом на реальном Postgres, 2026-09-30):
  // pg_advisory_xact_lock возвращает void, а Prisma не умеет десериализовать
  // void в $queryRaw — падает «Failed to deserialize column of type 'void'».
  // Приводим к text; сам вызов блокирующий, значение результата не используется.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`
}

/**
 * Денежная транзакция одного кошелька: advisory-лок + ReadCommitted + повтор
 * при конфликте. Единственная точка, где money-операция открывает транзакцию
 * с сериализацией по кошельку.
 */
export async function runWalletTransaction<T>(
  target: WalletLockTarget,
  body: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await acquireWalletLock(tx, target)
          return body(tx)
        },
        { isolationLevel: 'ReadCommitted' },
      )
    } catch (error) {
      if (!isRetryableConflict(error) || attempt === MAX_ATTEMPTS) {
        throw error
      }
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
    }
  }
  throw lastError
}
