/**
 * Prisma-реализация порта внешних запросов партнёрской программы.
 *
 * ЧТЕНИЯ чужих таблиц (`users`, `kyc_profiles`) — легальны: ADR GAP-51
 * (2026-09-04) фиксирует read-only доступ через общий Prisma-клиент как принятое
 * решение всего репозитория, пересматривается при выносе модулей в отдельные
 * сервисы/БД. Обход идёт через порт `AffiliatePlayerProvisioningRepository`,
 * чтобы application-слой не импортировал Prisma (AI_DEVELOPMENT_RULES §3.2).
 *
 * ⚠️ GAP-62 — ПРАВОК НА ЧУЖИЕ ТАБЛИЦЫ, ADR GAP-51 ЭТО НЕ РАЗРЕШАЕТ.
 * `createPlayerUser` (INSERT в `users`) и `deletePlayerUser` (DELETE из `users`)
 * пишут в таблицу, владельцем которой является модуль `users`. Убрать их отсюда
 * в этой волне НЕЛЬЗЯ: `UsersFacade` (единственный публичный API модуля users,
 * `exports: [UsersFacade, SelfExclusionUseCase]`) не предоставляет ни создания,
 * ни удаления учётной записи — записать партнёра не через кого. Правка фасада
 * `users` вне рамок этой задачи (модуль ведёт другой агент).
 *
 * ЧТО НУЖНО, ЧТОБЫ ЗАКРЫТЬ GAP-62 (запрос к владельцу данных, модуль `users`):
 *   1) `UsersFacade.provisionAffiliatePlayer(input: { referralCode: string })
 *      : Promise<{ id: string }>` — создаёт служебную user-запись партнёра
 *      (email=null, status='active', referral_code уникален) и отвечает за
 *      валидацию уникальности кода;
 *   2) `UsersFacade.deprovisionAffiliatePlayer(userId: string): Promise<void>`
 *      — компенсационное удаление сироты при отказе записи партнёра;
 *   3) опционально `UsersFacade.isReferralCodeAvailable(code: string)` — тогда
 *      и чтение `users.referral_code` уйдёт из affiliate.
 * После этого из affiliate убирается и сам порт
 * `AFFILIATE_PLAYER_PROVISIONING_REPOSITORY` (его методы становятся тонкой
 * обёрткой над фасадом), а `affiliate.module.ts` начинает полагаться только на
 * `UsersFacade`.
 *
 * Межтем временем прямой доступ помечен здесь, в `affiliate.module.ts` и в
 * `README.md` модуля: нарушение ADR не должно выглядеть исполненным решением.
 */
import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import type { AffiliatePlayerProvisioningRepository } from '../domain/repositories/affiliate.repository'

/** Префикс служебных referral_code партнёра — в данных видно, что это не игровой код. */
const AFFILIATE_REFERRAL_PREFIX = 'aff'

@Injectable()
export class PrismaPlayerProvisioningRepository implements AffiliatePlayerProvisioningRepository {
  /**
   * GAP-62: WRITE в чужую таблицу `users`. См. шапку файла — причина и список
   * методов `UsersFacade`, которые нужны, чтобы эту запись вернуть владельцу.
   */
  async createPlayerUser(args: { referralCode: string }): Promise<{ id: string }> {
    const user = await prisma.user.create({
      data: {
        // email у партнёра живёт в affiliates.email. Поле users.email уникально
        // и nullable, поэтому оставляем пустым: один и тот же человек может
        // быть и игроком, и партнёром, не создавая конфликта уникальности.
        email: null,
        status: 'active',
        referralCode: args.referralCode,
      },
      select: { id: true },
    })
    return user
  }

  /**
   * GAP-62: WRITE (компенсирующее удаление) в чужую таблицу `users`.
   * Вызывается только когда запись партнёра не состоялась — иначе в `users`
   * остаётся сирота без affiliate-строки.
   */
  async deletePlayerUser(userId: string): Promise<void> {
    await prisma.user.delete({ where: { id: userId } })
  }

  /** READ чужой таблицы — ADR GAP-51 (см. шапку файла). */
  async isPlayerReferralCodeAvailable(code: string): Promise<boolean> {
    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    })
    return existing === null
  }

  /** READ чужой таблицы (kyc) — ADR GAP-51. */
  async isKycApproved(playerId: string): Promise<boolean> {
    const profile = await prisma.kycProfile.findUnique({
      where: { userId: playerId },
      select: { status: true },
    })
    return profile?.status === 'approved'
  }
}

export { AFFILIATE_REFERRAL_PREFIX }
