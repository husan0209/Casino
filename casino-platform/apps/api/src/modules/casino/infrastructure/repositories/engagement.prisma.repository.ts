/**
 * ТЗ ч.9 §3.1, §16.1 №7 — Prisma-реализация хранилища движка вовлечения.
 *
 * Пишет состояние пары (игрок, игра) и append-only журнал решений (§11.3).
 * Денежные величины приходят из домена строками и уходят в NUMERIC — Decimal
 * в Prisma выставляется строкой, поэтому округление остаётся под контролем
 * decimal.js, а не double.
 */
import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'
import type { Currency } from '@casino/shared-types'

import { toEngagementState, toEngagementStateWrite } from '../mappers/engagement.mapper'

import type { EngagementState } from '../../domain/engagement'
import type {
  EngagementEventInput,
  IEngagementRepository,
  SaveEngagementStateInput,
} from '../../domain/repositories/engagement.repository'
import type { Prisma } from '@prisma/client'

@Injectable()
export class PrismaEngagementRepository implements IEngagementRepository {
  async getState(
    userId: string,
    gameId: string,
    currency: Currency = 'RUB',
  ): Promise<EngagementState | null> {
    const row = await prisma.playerEngagementState.findUnique({
      where: { userId_gameId: { userId, gameId } },
    })
    if (!row) {
      return null
    }
    return toEngagementState(row, currency)
  }

  async saveState(input: SaveEngagementStateInput): Promise<void> {
    const { state, currentBalance, snapshot } = input
    const data = toEngagementStateWrite({ state, currentBalance, snapshot })
    await prisma.playerEngagementState.upsert({
      where: { userId_gameId: { userId: state.userId, gameId: state.gameId } },
      update: data,
      create: {
        userId: state.userId,
        gameId: state.gameId,
        ...data,
      },
    })
  }

  async appendEvent(event: EngagementEventInput): Promise<void> {
    await prisma.engagementEvent.create({
      data: {
        userId: event.userId,
        gameId: event.gameId,
        sessionId: event.sessionId,
        eventType: event.eventType,
        spinIndex: event.spinIndex,
        phase: event.phase,
        payload: event.payload as Prisma.InputJsonValue,
      },
    })
  }
}
