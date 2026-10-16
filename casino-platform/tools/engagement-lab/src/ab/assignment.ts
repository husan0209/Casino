/**
 * §12.1 + §12.2: детерминированное распределение игрока по тестовым группам.
 *
 * Stratified sampling (§12.1, принцип 3) реализован так: сегмент игрока
 * (новичок / регуляр / VIP) входит в ключ хеша, поэтому каждый сегмент
 * режется собственным независимым срезом и внутри него доли из §12.2
 * выдерживаются отдельно. Никакого `Math.random`: один и тот же
 * `(userId, segment)` всегда даёт одну и ту же группу.
 *
 * Лаборатория не пишет назначение в БД. В проде первый снимок обязаны
 * зафиксировать (запись `engagement_ab_assignment`), потому что смена сегмента
 * игрока меняет ключ хеша, а значит и корзину: stickiness обеспечивает
 * сохранённое значение, а не эта функция (§12.1, принцип 1 gradual rollout).
 */
import { createHash } from 'node:crypto'

import { AB_GROUPS } from '../config'
import { type ABGroupName, AB_GROUP_NAMES, percentageOfGroup } from './mechanics'

/** §12.1, принцип 3: сегменты стратификации. */
export type PlayerSegment = 'newcomer' | 'regular' | 'vip'

/** Те же сегменты списком: обход для A/A проверки и для отчёта §13.5. */
export const PLAYER_SEGMENTS: readonly PlayerSegment[] = ['newcomer', 'regular', 'vip']

/**
 * Корзин ровно 100: тогда процент группы из §12.2 — это количество корзин,
 * и доля группы читается из среза без деления и без округления.
 */
const BUCKET_COUNT = 100

/** Префикс ключа хеша: корзины A/B не пересекаются с другими хеш-ключами лаборатории. */
const HASH_DOMAIN = 'engagement-ab-v1'

/**
 * Сколько hex-символов sha256 уходит в число: 16 символов = 64 бита.
 * Смещение от `2^64 mod 100 = 16` не больше 1e-17 доли — на 1000 игроков
 * незаметно, а пересчёт остаётся дешёвым.
 */
const HASH_HEX_LENGTH = 16

/** Доля одной группы в явном сплите (§15.3: постепенный откат меняет долю). */
export interface ABGroupSplitSlice {
  group: ABGroupName
  percentage: number
}

/** Результат распределения: группа плюс корзина для аудита A/A (§12.1). */
export interface ABAssignment {
  userId: string
  segment: PlayerSegment
  group: ABGroupName
  bucket: number
}

/** Полуинтервал `[minBucket, maxBucket)` одной группы. */
interface ABGroupBucketRange {
  group: ABGroupName
  minBucket: number
  maxBucket: number
}

/** Сплит §12.2 по умолчанию: проценты берутся из AB_GROUPS, не отсюда. */
const DEFAULT_SPLIT: readonly ABGroupSplitSlice[] = AB_GROUPS.map((group): ABGroupSplitSlice => ({
  group: group.name,
  percentage: group.percentage,
}))

const RANGE_CACHE = new WeakMap<readonly ABGroupSplitSlice[], readonly ABGroupBucketRange[]>()

/** Ключ хеша: видно, из чего считается корзина, при разборе конкретного игрока. */
export function assignmentKey(userId: string, segment: PlayerSegment): string {
  return `${HASH_DOMAIN}:${segment}:${userId}`
}

/**
 * Корзина игрока: sha256 от ключа, первые 64 бита, по модулю 100.
 * Детерминировано при том же входе на любом узле (у sha256 нет случайности).
 */
export function bucketOf(userId: string, segment: PlayerSegment): number {
  requireKnownSegment(segment)
  const digest = createHash('sha256').update(assignmentKey(userId, segment), 'utf8').digest('hex')
  const head = BigInt(`0x${digest.slice(0, HASH_HEX_LENGTH)}`)
  return Number(head % BigInt(BUCKET_COUNT))
}

/**
 * Раскладка сплита по корзинам: группы идут друг за другом, сумма долей
 * обязана равняться BUCKET_COUNT, иначе часть игроков осталась бы без группы.
 */
function buildRanges(split: readonly ABGroupSplitSlice[]): readonly ABGroupBucketRange[] {
  const cached = RANGE_CACHE.get(split)
  if (cached !== undefined) {
    return cached
  }

  const ranges: ABGroupBucketRange[] = []
  const seenGroups = new Set<string>()
  let cursor = 0

  for (const slice of split) {
    if (seenGroups.has(slice.group)) {
      throw new Error(`A/B сплит: группа ${slice.group} объявлена дважды (§12.2)`)
    }
    if (Number.isFinite(slice.percentage) === false || slice.percentage < 0) {
      throw new Error(`A/B сплит: доля группы ${slice.group} некорректна: ${slice.percentage}`)
    }
    if (Number.isInteger(slice.percentage) === false) {
      throw new Error(
        `A/B сплит: доля группы ${slice.group} должна быть целым числом процентов, корзина равна ${BUCKET_COUNT}`,
      )
    }

    seenGroups.add(slice.group)
    ranges.push({ group: slice.group, minBucket: cursor, maxBucket: cursor + slice.percentage })
    cursor += slice.percentage
  }

  if (cursor !== BUCKET_COUNT) {
    throw new Error(
      `A/B сплит: сумма долей ${cursor} != ${BUCKET_COUNT} (§12.2 требует ровно 100 процентов)`,
    )
  }

  const frozen: readonly ABGroupBucketRange[] = ranges
  RANGE_CACHE.set(split, frozen)
  return frozen
}

/** Корзина -> группа в заданном сплите. */
function groupOfBucket(bucket: number, ranges: readonly ABGroupBucketRange[]): ABGroupName {
  const range = ranges.find(
    (candidate): boolean => bucket >= candidate.minBucket && bucket < candidate.maxBucket,
  )
  if (range === undefined) {
    throw new Error(`A/B сплит: корзина ${bucket} не попала ни в одну группу`)
  }
  return range.group
}

/** Распределение по группам §12.2 с долями из конфига. */
export function assignGroup(userId: string, segment: PlayerSegment): ABAssignment {
  return assignGroupWithSplit(userId, segment, DEFAULT_SPLIT)
}

/**
 * Распределение с явными долями: нужно для моделирования §15.3
 * (уменьшение доли группы с 20 % до 10 %) и для A/A теста §12.1.
 */
export function assignGroupWithSplit(
  userId: string,
  segment: PlayerSegment,
  split: readonly ABGroupSplitSlice[],
): ABAssignment {
  if (userId.length === 0) {
    throw new Error('A/B распределение: пустой userId')
  }
  if (split.length === 0) {
    throw new Error('A/B распределение: пустой сплит групп')
  }

  const bucket = bucketOf(userId, segment)
  const group = groupOfBucket(bucket, buildRanges(split))
  return { userId, segment, group, bucket }
}

/** Счётчики по группам: пустые группы тоже в ответе, иначе отчёт «съедет». */
export function countByGroup(assignments: readonly ABAssignment[]): Record<ABGroupName, number> {
  const counts = emptyGroupCounts()
  for (const assignment of assignments) {
    counts[assignment.group] += 1
  }
  return counts
}

/** Доли по группам (0..1): сравнение с §12.2 в тесте A/A (§12.1, принцип 2). */
export function shareByGroup(assignments: readonly ABAssignment[]): Record<ABGroupName, number> {
  const counts = countByGroup(assignments)
  const shares = emptyGroupCounts()
  if (assignments.length === 0) {
    return shares
  }
  for (const group of AB_GROUP_NAMES) {
    shares[group] = counts[group] / assignments.length
  }
  return shares
}

/** Счётчики по сегментам: страты должны быть покрыты ровно (§12.1, принцип 3). */
export function countBySegment(
  assignments: readonly ABAssignment[],
): Record<PlayerSegment, number> {
  const counts: Record<PlayerSegment, number> = { newcomer: 0, regular: 0, vip: 0 }
  for (const assignment of assignments) {
    counts[assignment.segment] += 1
  }
  return counts
}

/** Ожидание по группе из §12.2: та же величина, что и в конфиге, без дубля. */
export function expectedShareOf(group: ABGroupName): number {
  return percentageOfGroup(group) / 100
}

function emptyGroupCounts(): Record<ABGroupName, number> {
  const counts = {} as Record<ABGroupName, number>
  for (const group of AB_GROUP_NAMES) {
    counts[group] = 0
  }
  return counts
}

function requireKnownSegment(segment: PlayerSegment): void {
  if (PLAYER_SEGMENTS.includes(segment) === false) {
    throw new Error(`Неизвестный сегмент игрока: ${segment} (§12.1: ${PLAYER_SEGMENTS.join(', ')})`)
  }
}
