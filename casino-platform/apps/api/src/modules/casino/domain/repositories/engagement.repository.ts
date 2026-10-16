/**
 * ТЗ ч.9 §3.1, §16.1 №6 — порт хранилища движка вовлечения.
 *
 * Домен объявляет интерфейс, infrastructure реализует его на Prisma. События
 * журнала (§11.3) пишутся тем же портом: append-only лог нужен и для аналитики,
 * и для разбора инцидентов, а держать второй репозиторий незачем.
 */
import type { Currency, MoneyAmount } from '@casino/shared-types'

import type { EngagementPhase, EngagementState, EngagementSessionSnapshot } from '../engagement'

/** Тип события журнала — совпадает с enum `EngagementEventType` в БД. */
export type EngagementEventType =
  'phase_changed' | 'rtp_adjusted' | 'ldw_applied' | 'near_miss_applied' | 'reactivation_credited'

export interface EngagementEventInput {
  readonly userId: string
  readonly gameId: string
  readonly sessionId: string | null
  readonly eventType: EngagementEventType
  readonly spinIndex: number | null
  readonly phase: EngagementPhase | null
  readonly payload: Record<string, unknown>
}

export interface SaveEngagementStateInput {
  readonly state: EngagementState
  /** Текущий баланс кошелька на момент спина — §3.1 currentBalance. */
  readonly currentBalance: MoneyAmount
  readonly snapshot: EngagementSessionSnapshot | null
}

export interface IEngagementRepository {
  /**
   * §3.1 — состояние пары (игрок, игра); null, если пара ещё не заводилась.
   * Валюта передаётся вызывающим: состояние хранится на пару игрок+игра,
   * а баланс и база §4.1 живут в кошельке конкретной валюты сессии.
   */
  getState(userId: string, gameId: string, currency: Currency): Promise<EngagementState | null>

  /** §3.1 — upsert состояния. Вызывается один раз на спин. */
  saveState(input: SaveEngagementStateInput): Promise<void>

  /** §11.3 — append-only журнал решений движка. */
  appendEvent(event: EngagementEventInput): Promise<void>
}

export const ENGAGEMENT_REPOSITORY = Symbol('ENGAGEMENT_REPOSITORY')
