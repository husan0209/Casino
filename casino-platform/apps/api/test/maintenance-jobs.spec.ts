/**
 * Юнит-тесты maintenance-job'ов (GAP-33, ТЗ ч.3 §13).
 *
 * Каждая задача проверяется на in-memory фейках портов (критерии 2–4 GAP-33):
 * - депозит pending 3ч назад → expired; 1ч назад → не тронут;
 *   крипто — по expires_at от провайдера;
 * - напоминание о выводе >24ч: письмо всем активным админам + запись в audit_log,
 *   повторный тик НЕ дублирует (дедуп по audit_log за окно);
 * - update-rates: провайдер жив → source провайдера; провайдер упал → fallback
 *   константы DISPLAY_RUB_RATES (source='static'), задача не роняется;
 * - referral-daily: проксирует runDaily, возвращает сводку.
 */
import { ExpireDepositsJob } from '../src/modules/maintenance/application/expire-deposits.job'
import { ReferralDailyJob } from '../src/modules/maintenance/application/referral-daily.job'
import { UpdateRatesJob } from '../src/modules/maintenance/application/update-rates.job'
import { WithdrawalReminderJob } from '../src/modules/maintenance/application/withdrawal-reminder.job'
import { MaintenanceScheduler } from '../src/queues/infrastructure/maintenance.scheduler'
import { DISPLAY_RUB_RATES } from '@casino/shared-config'
import type {
  IPaymentMaintenanceRepo,
  IReminderAuditRepo,
  IExchangeRateWriter,
  IRatesProvider,
  MaintenancePaymentRow,
  MaintenanceHandlers,
} from '../src/modules/maintenance/domain/maintenance.ports'
import type { ConfigService } from '@nestjs/config'

const NOW = new Date('2026-09-02T12:00:00.000Z')
const TWO_HOURS_MS = 2 * 3_600_000

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService
}

function makePaymentsRepo(
  deposits: MaintenancePaymentRow[] = [],
  withdrawals: MaintenancePaymentRow[] = [],
): IPaymentMaintenanceRepo & { expiredIds: string[] } {
  const expiredIds: string[] = []
  return {
    expiredIds,
    listPendingDeposits: async () => deposits,
    listPendingWithdrawals: async () => withdrawals,
    markExpired: async (id: string) => {
      expiredIds.push(id)
    },
  }
}

function makeAuditRepo(
  adminEmails: string[] = [],
  alreadyRemindedIds: string[] = [],
): IReminderAuditRepo & { reminders: Array<{ targetId: string; adminsNotified: number }> } {
  const reminders: Array<{ targetId: string; adminsNotified: number }> = []
  return {
    reminders,
    activeAdminEmails: async () => adminEmails,
    findRecentReminder: async (id: string) => alreadyRemindedIds.includes(id),
    recordReminder: async (input: { targetId: string; adminsNotified: number }) => {
      reminders.push({ targetId: input.targetId, adminsNotified: input.adminsNotified })
    },
  }
}

function makeEmailQueue() {
  const enqueued: Array<{ to: string; subject: string; text: string }> = []
  return {
    enqueued,
    enqueue: async (job: { to: string; subject: string; text: string }) => {
      enqueued.push(job)
      return 'queued' as const
    },
  }
}

function paymentRow(over: Partial<MaintenancePaymentRow>): MaintenancePaymentRow {
  return {
    id: 'pr_' + Math.random().toString(36).slice(2, 8),
    createdAt: NOW,
    provider: 'rukassa',
    expiresAt: null,
    ...over,
  }
}

describe('maintenance jobs (GAP-33)', () => {
  describe('ExpireDepositsJob', () => {
    it('депозит pending 3ч назад → expired (критерий 2: по возрасту, фиат)', async () => {
      const stale = paymentRow({ createdAt: new Date(NOW.getTime() - 3 * 3_600_000) })
      const repo = makePaymentsRepo([stale])
      const res = await new ExpireDepositsJob(repo).execute(NOW)
      expect(res.expired).toBe(1)
      expect(repo.expiredIds).toEqual([stale.id])
    })

    it('депозит pending 1ч назад → не тронут (критерий 2)', async () => {
      const fresh = paymentRow({ createdAt: new Date(NOW.getTime() - 3_600_000) })
      const repo = makePaymentsRepo([fresh])
      const res = await new ExpireDepositsJob(repo).execute(NOW)
      expect(res.expired).toBe(0)
      expect(res.skipped).toBe(1)
      expect(repo.expiredIds).toEqual([])
    })

    it('крипто с expires_at в будущем → не тронут (по expires_at от провайдера)', async () => {
      const dep = paymentRow({
        provider: 'nowpayments',
        createdAt: new Date(NOW.getTime() - 3 * 3_600_000), // старше 2ч, но expires_at жив
        expiresAt: new Date(NOW.getTime() + 1_800_000),
      })
      const repo = makePaymentsRepo([dep])
      const res = await new ExpireDepositsJob(repo).execute(NOW)
      expect(res.expired).toBe(0)
      expect(repo.expiredIds).toEqual([])
    })

    it('крипто с просроченным expires_at → expired', async () => {
      const dep = paymentRow({
        provider: 'nowpayments',
        expiresAt: new Date(NOW.getTime() - 60_000),
      })
      const repo = makePaymentsRepo([dep])
      const res = await new ExpireDepositsJob(repo).execute(NOW)
      expect(res.expired).toBe(1)
      expect(repo.expiredIds).toEqual([dep.id])
    })

    it('идемпотентен: повторный прогон после истечения ничего не меняет (статус уже expired — не в выборке)', async () => {
      const repo = makePaymentsRepo([]) // expired депозиты больше не pending
      const res = await new ExpireDepositsJob(repo).execute(NOW)
      expect(res.expired).toBe(0)
    })
  })

  describe('WithdrawalReminderJob', () => {
    it('вывод pending >24ч: письмо каждому активному админу + запись в audit_log', async () => {
      const stale = paymentRow({ createdAt: new Date(NOW.getTime() - 30 * 3_600_000), amount: '100', currency: 'RUB' })
      const repo = makePaymentsRepo([], [stale])
      const audit = makeAuditRepo(['a1@casino.dev', 'a2@casino.dev'])
      const email = makeEmailQueue()
      const res = await new WithdrawalReminderJob(repo, audit, email).execute(NOW)
      expect(res.reminded).toBe(1)
      expect(email.enqueued).toHaveLength(2)
      expect(email.enqueued[0]!.to).toBe('a1@casino.dev')
      expect(email.enqueued[0]!.subject).toContain('RUB 100')
      expect(audit.reminders).toEqual([{ targetId: stale.id, adminsNotified: 2 }])
    })

    it('повторный тик НЕ дублирует напоминание (критерий 3: дедуп по audit_log)', async () => {
      const stale = paymentRow({ createdAt: new Date(NOW.getTime() - 30 * 3_600_000) })
      const repo = makePaymentsRepo([], [stale])
      const audit = makeAuditRepo(['a1@casino.dev'], [stale.id])
      const email = makeEmailQueue()
      const res = await new WithdrawalReminderJob(repo, audit, email).execute(NOW)
      expect(res.reminded).toBe(0)
      expect(res.skipped).toBe(1)
      expect(email.enqueued).toHaveLength(0)
      expect(audit.reminders).toHaveLength(0)
    })

    it('вывод младше 24ч — не тронут', async () => {
      const fresh = paymentRow({ createdAt: new Date(NOW.getTime() - TWO_HOURS_MS) })
      const repo = makePaymentsRepo([], [fresh])
      const audit = makeAuditRepo(['a1@casino.dev'])
      const email = makeEmailQueue()
      const res = await new WithdrawalReminderJob(repo, audit, email).execute(NOW)
      expect(res.reminded).toBe(0)
      expect(email.enqueued).toHaveLength(0)
    })

    it('нет активных админов → ничего не шлём, сводка честная', async () => {
      const stale = paymentRow({ createdAt: new Date(NOW.getTime() - 30 * 3_600_000) })
      const repo = makePaymentsRepo([], [stale])
      const audit = makeAuditRepo([])
      const email = makeEmailQueue()
      const res = await new WithdrawalReminderJob(repo, audit, email).execute(NOW)
      expect(res).toEqual({ reminded: 0, skipped: 1, admins: 0 })
      expect(email.enqueued).toHaveLength(0)
    })
  })

  describe('UpdateRatesJob', () => {
    function makeWriter() {
      const saved: Array<{ currencyFrom: string; currencyTo: string; rate: string; source: string }> = []
      const cached: Array<Record<string, string>> = []
      const writer: IExchangeRateWriter = {
        saveRate: async (input) => {
          saved.push(input)
        },
        cacheRates: async (rates) => {
          cached.push(rates)
        },
      }
      return { saved, cached, writer }
    }

    it('провайдер вернул курс → пишется с source провайдера; остальные валюты — fallback констант', async () => {
      const provider: IRatesProvider = {
        estimateRub: async (currency: string) =>
          currency === 'USDT_TRC20' ? { rate: '100.5', source: 'np-dev-stub' } : null,
      }
      const { saved, cached, writer } = makeWriter()
      const res = await new UpdateRatesJob(writer, provider).execute(NOW)

      const usdt = saved.find((s) => s.currencyFrom === 'USDT_TRC20')
      expect(usdt).toEqual({ currencyFrom: 'USDT_TRC20', currencyTo: 'RUB', rate: '100.5', source: 'np-dev-stub' })
      // UAH/BYN/KZT/UZS/BTC — fallback на DISPLAY_RUB_RATES (source='static')
      const uah = saved.find((s) => s.currencyFrom === 'UAH')
      expect(uah).toEqual({ currencyFrom: 'UAH', currencyTo: 'RUB', rate: DISPLAY_RUB_RATES['UAH'], source: 'static' })
      expect(res.source).toBe('np-dev-stub')
      expect(res.updated).toBe(saved.length)
      expect(cached).toHaveLength(1)
      expect(cached[0]!['USDT_TRC20']).toBe('100.5')
      // RUB в таблицу не пишется
      expect(saved.find((s) => s.currencyFrom === 'RUB')).toBeUndefined()
    })

    it('сбой провайдера не роняет задачу — fallback на константы', async () => {
      const provider: IRatesProvider = {
        estimateRub: async () => {
          throw new Error('network down')
        },
      }
      const { saved, writer } = makeWriter()
      const res = await new UpdateRatesJob(writer, provider).execute(NOW)
      expect(res.updated).toBe(saved.length)
      expect(res.source).toBe('static')
      const btc = saved.find((s) => s.currencyFrom === 'BTC')
      expect(btc?.rate).toBe(DISPLAY_RUB_RATES['BTC'])
      expect(btc?.source).toBe('static')
    })
  })

  describe('ReferralDailyJob', () => {
    it('проксирует ReferralCalcService.runDaily и возвращает сводку (критерий 4: лог-сводка)', async () => {
      const calls: Array<string | undefined> = []
      const fakeCalc = {
        runDaily: async (dateStr?: string) => {
          calls.push(dateStr)
          return { processed: 2, credited: 1, date: NOW }
        },
      }
      const res = await new ReferralDailyJob(fakeCalc as never).execute()
      expect(calls).toEqual([undefined])
      expect(res).toEqual({ processed: 2, credited: 1, date: NOW })
    })

    it('проксирует явную дату (ручной запуск за произвольный день)', async () => {
      const calls: Array<string | undefined> = []
      const fakeCalc = {
        runDaily: async (dateStr?: string) => {
          calls.push(dateStr)
          return { processed: 0, credited: 0, date: new Date('2026-08-31T00:00:00.000Z') }
        },
      }
      await new ReferralDailyJob(fakeCalc as never).execute('2026-08-31')
      expect(calls).toEqual(['2026-08-31'])
    })
  })

  describe('MaintenanceScheduler', () => {
    it('без REDIS_URL (dev) — repeatable не регистрируются, метод безопасен', async () => {
      const scheduler = new MaintenanceScheduler(makeConfig({ REDIS_URL: undefined, NODE_ENV: undefined }))
      await expect(scheduler.registerRepeatableJobs()).resolves.toBeUndefined()
    })

    it('в NODE_ENV=test — тоже no-op (не мешает юнит-тестам/E2E-подключениям)', async () => {
      const scheduler = new MaintenanceScheduler(makeConfig({ REDIS_URL: 'redis://x', NODE_ENV: 'test' }))
      await expect(scheduler.registerRepeatableJobs()).resolves.toBeUndefined()
    })

    it('map хендлеров покрывает все 4 job name (тип-гарантия диспетчера)', () => {
      // Проверяем контракт: все имена из MAINTENANCE_JOBS имеют хендлер.
      // (worker dispatch при неизвестном имени бросит — см. интеграцию)
      const handlers: MaintenanceHandlers = {
        'expire-deposits': async () => ({ expired: 0, skipped: 0 }),
        'update-rates': async () => ({ updated: 0, skipped: 0, source: 'static' }),
        'withdrawal-reminder': async () => ({ reminded: 0, skipped: 0, admins: 0 }),
        'referral-daily': async () => ({ processed: 0, credited: 0 }),
      }
      for (const name of ['expire-deposits', 'update-rates', 'withdrawal-reminder', 'referral-daily'] as const) {
        expect(typeof handlers[name]).toBe('function')
      }
    })
  })
})
