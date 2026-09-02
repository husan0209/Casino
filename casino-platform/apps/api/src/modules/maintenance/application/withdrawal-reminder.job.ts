import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import {
  MAINTENANCE_EMAIL_PORT,
  PAYMENT_MAINTENANCE_REPO,
  REMINDER_AUDIT_REPO,
  type IPaymentMaintenanceRepo,
  type IReminderAuditRepo,
  type ReminderResult,
} from '../domain/maintenance.ports'

/** Напоминаем о выводах, висящих в pending дольше суток — ТЗ ч.3 §13. */
const WITHDRAWAL_STALE_MS = 24 * 3_600_000
/** Дедуп-окно: одна запись в audit_log на вывод (повторные тики не шлют письмо). */
const REMINDER_DEDUP_MS = 24 * 3_600_000

/**
 * Job `withdrawal-reminder` (GAP-33, ТЗ ч.3 §13): каждые
 * JOB_WITHDRAWAL_REMINDER_EVERY_MS (default 1ч) напоминает админам о выводах
 * в pending >24ч.
 *
 * Уведомление админам — EMAIL всем активным admin_users (таблица notifications
 * ссылается на users FK — админы там не живут), + запись в audit_log
 * (`maintenance.withdrawal_reminder`, targetId = withdrawal id) как трейл.
 * Дедупликация: не чаще одной записи на вывод за окно REMINDER_DEDUP_MS —
 * повторный тик письмо не дублирует (criterion 3 GAP-33).
 */
@Injectable()
export class WithdrawalReminderJob {
  private readonly logger = new Logger(WithdrawalReminderJob.name)

  constructor(
    @Inject(PAYMENT_MAINTENANCE_REPO) private readonly repo: IPaymentMaintenanceRepo,
    @Inject(REMINDER_AUDIT_REPO) private readonly audit: IReminderAuditRepo,
    @Inject(MAINTENANCE_EMAIL_PORT) private readonly emailQueue: { enqueue(job: { to: string; subject: string; text: string }): Promise<string> },
  ) {}

  async execute(now = new Date()): Promise<ReminderResult> {
    const since = new Date(now.getTime() - WITHDRAWAL_STALE_MS)
    const all = await this.repo.listPendingWithdrawals()
    const stale = all.filter((w) => w.createdAt.getTime() <= since.getTime())
    if (stale.length === 0) {
      return { reminded: 0, skipped: 0, admins: 0 }
    }
    const admins = await this.audit.activeAdminEmails()
    if (admins.length === 0) {
      this.logger.warn(`withdrawal-reminder: ${stale.length} stale withdrawals, but no active admins`)
      return { reminded: 0, skipped: stale.length, admins: 0 }
    }

    const dedupSince = new Date(now.getTime() - REMINDER_DEDUP_MS)
    let reminded = 0
    let skipped = 0
    for (const w of stale) {
      if (await this.audit.findRecentReminder(w.id, dedupSince)) {
        skipped++
        continue
      }
      const hoursPending = Math.floor((now.getTime() - w.createdAt.getTime()) / 3_600_000)
      const amount = w.amount ?? '?'
      const currency = w.currency ?? ''
      const subject = `[Casino] Вывод ${currency} ${amount} в pending ${hoursPending}ч`
      const text = `Заявка на вывод ${w.id} (${currency} ${amount}) от пользователя ${hoursPending} ч назад\nвсе ещё в статусе pending. Проверьте Admin → Finance → Withdrawals.`
      let sent = 0
      for (const to of admins) {
        try {
          await this.emailQueue.enqueue({ to, subject, text })
          sent++
        } catch (e) {
          // Письмо — side-effect: сбои фиксируем в сводке, не роняем задачу
          this.logger.warn(`withdrawal-reminder: email to ${to} failed: ${errorMessage(e)}`)
        }
      }
      await this.audit.recordReminder({ targetId: w.id, adminsNotified: sent, count: stale.length })
      reminded++
    }
    this.logger.log(`withdrawal-reminder: stale=${stale.length} reminded=${reminded} skipped=${skipped} admins=${admins.length}`)
    return { reminded, skipped, admins: admins.length }
  }
}
