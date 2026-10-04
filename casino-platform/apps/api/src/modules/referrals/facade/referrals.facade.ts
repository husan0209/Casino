/**
 * Публичный API referrals-модуля (MODULE_TEMPLATE Шаг 8).
 *
 * Потребитель один — модуль `maintenance`: cron-job `referral-daily` и ручной
 * триггер `POST /admin/referrals/run-daily`. До фасада оба тянули
 * `ReferralCalcService` из `referrals/application/` напрямую — это и был остаток
 * межмодульного долга G16 (`tech-debt/cross-module-imports.txt`).
 *
 * Наружу выставлен ровно тот контур, который реально дёргают извне: суточный
 * расчёт GGR-share и его сводка. Чтение начислений (`GET /admin/referrals`,
 * `GET /admin/referrals/stats`, `GET /referrals/info`) живёт в presentation
 * самого модуля: внешнего потребителя у него нет, поэтому в фасад он не
 * переезжает — метод «на всякий случай» был бы только местом будущего дрейфа.
 */
import { Inject, Injectable } from '@nestjs/common'

import { ReferralCalcService, type ReferralDailyResult } from '../application/referral-calc.service'

export type { ReferralDailyResult } from '../application/referral-calc.service'

@Injectable()
export class ReferralsFacade {
  constructor(@Inject(ReferralCalcService) private readonly referralCalc: ReferralCalcService) {}

  /**
   * Суточный расчёт GGR-share по всем реферальным связкам.
   *
   * `dateStr` (`YYYY-MM-DD`) — за какой день считать; без него считается
   * вчерашний день (UTC). Вызов идемпотентен: дедуп по `findReward`
   * (реферер+реферед+день+валюта) и `idempotencyKey` проводки, поэтому
   * повторный запуск за тот же день не создаёт вторых зачислений — ретрай
   * очереди и ручной триггер поверх крона безопасны.
   *
   * Перед новым расчётом прогон делает compensation-проход по начислениям в
   * статусе `pending` (документ есть, проводки нет): без него отказ
   * кредитования терял деньги навсегда, т.к. дедуп по кортежу суток считал
   * строку готовой. Повтор идёт по тому же `idempotencyKey`, поэтому ledger
   * отвечает `duplicate`, а не второй выплатой. Счётчик `processed` в сводке —
   * это взятые в работу записи (созданные + повторно начисленные), не только
   * созданные.
   *
   * Возвращается сводка дня: потребитель (maintenance) логирует её, пишет в
   * `audit_logs` и отдаёт в ответе админу — поэтому счётчики идут наружу.
   */
  async runDaily(dateStr?: string): Promise<ReferralDailyResult> {
    const result = await this.referralCalc.runDaily(dateStr)
    return {
      processed: result.processed,
      credited: result.credited,
      date: result.date,
    }
  }
}
