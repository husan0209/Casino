import { Inject, Injectable, Logger } from '@nestjs/common'

import {
  PAYMENT_MAINTENANCE_REPO,
  type ExpiredCountResult,
  type IPaymentMaintenanceRepo,
} from '../domain/maintenance.ports'

/** Окно ожидания депозита для фиата (без expires_at) — ТЗ ч.3 §13: 2 часа. */
const FIAT_PENDING_TTL_MS = 2 * 3_600_000

/**
 * Job `expire-deposits` (GAP-33, ТЗ ч.3 §13): каждые JOB_EXPIRE_DEPOSITS_EVERY_MS
 * (default 5 мин) переводит pending-депозиты в `expired`:
 * - крипто (nowpayments) — по `expires_at` от провайдера;
 * - фиат (rukassa/manual) — по 2ч с `created_at`.
 * Идемпотентен: статус меняется условным update; вебхук провайдера по истёкшему
 * платежу всё равно зачислит депозит (classifyPaymentStatus('success') не смотрит
 * наш статус) — деньги не теряются.
 * Возвращает сводку {expired, skipped} — criterion 4 GAP-33.
 */
@Injectable()
export class ExpireDepositsJob {
  private readonly logger = new Logger(ExpireDepositsJob.name)

  constructor(@Inject(PAYMENT_MAINTENANCE_REPO) private readonly repo: IPaymentMaintenanceRepo) {}

  async execute(now = new Date()): Promise<ExpiredCountResult> {
    const pending = await this.repo.listPendingDeposits()
    let expired = 0
    let skipped = 0
    for (const dep of pending) {
      const isExpired = dep.expiresAt ? dep.expiresAt.getTime() <= now.getTime() : now.getTime() - dep.createdAt.getTime() > FIAT_PENDING_TTL_MS
      if (!isExpired) {
        skipped++
        continue
      }
      await this.repo.markExpired(dep.id)
      expired++
    }
    this.logger.log(`expire-deposits: expired=${expired} skipped=${skipped}`)
    return { expired, skipped }
  }
}
