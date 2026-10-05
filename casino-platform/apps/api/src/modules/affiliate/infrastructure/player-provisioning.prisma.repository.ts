/**
 * Prisma-реализация порта внешних ЗАПРОСОВ НА ЧТЕНИЕ чужих таблиц.
 *
 * ЧТЕНИЯ чужих таблиц (`users`, `kyc_profiles`) — легальны: ADR GAP-51
 * (2026-09-04) фиксирует read-only доступ через общий Prisma-клиент как принятое
 * решение всего репозитория, пересматривается при выносе модулей в отдельные
 * сервисы/БД. Обход идёт через порт `AffiliatePlayerProvisioningRepository`,
 * чтобы application-слой не импортировал Prisma (AI_DEVELOPMENT_RULES §3.2).
 *
 * GAP-62 ЗАКРЫТ (2026-10-03). Отсюда убраны `createPlayerUser` (INSERT в
 * `users`) и `deletePlayerUser` (DELETE из `users`) — правки в чужую таблицу,
 * которые ADR GAP-51 НЕ разрешает. Провижининг служебной учётки партнёра и её
 * компенсационное удаление теперь делает владелец данных:
 *   - `UsersFacade.provisionAffiliatePlayer({ referralCode })` → `{ id }`;
 *   - `UsersFacade.deprovisionAffiliatePlayer(userId)`.
 * Вызовы идут из `application/use-cases/register-affiliate.use-case.ts` и
 * `create-affiliate-by-admin.use-case.ts` (межмодульное общение только через
 * фасад — MODULE_BOUNDARIES).
 *
 * Пометка про read-only остаётся актуальной: порт здесь именно для чтений —
 * `isPlayerReferralCodeAvailable` (нужен генератору кода, чтобы не вставлять
 * занятый `referral_code`) и `isKycApproved` (нужен квалификации атрибуции).
 * Через `UsersFacade` их не получить: `kyc_profiles` — не таблица users, а
 * проверка «код свободен» была бы фасадом ради фасада, тогда как чтение уже
 * легализовано GAP-51.
 */
import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import type { AffiliatePlayerProvisioningRepository } from '../domain/repositories/affiliate.repository'

/** Префикс служебных referral_code партнёра — в данных видно, что это не игровой код. */
const AFFILIATE_REFERRAL_PREFIX = 'aff'

@Injectable()
export class PrismaPlayerProvisioningRepository implements AffiliatePlayerProvisioningRepository {
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
