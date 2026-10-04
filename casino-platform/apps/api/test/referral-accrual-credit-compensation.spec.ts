/**
 * Юнит-тесты ReferralCalcService — суточного начисления GGR-доли (слепая зона G21).
 *
 * Единственный существующий.spec на этот сервис (referral-payout.integration) —
 * `describe.skip` без LEDGER_INTEGRATION=1, т.е. локально не исполняется вообще,
 * а в CI проверяет только успех. Здесь закрыто то, чего интеграция не проверяет
 * никогда: поведение при ОТКАЗЕ денежного контура и порядок шагов.
 *
 * Что ловят эти тесты (реальные ошибки, а не имитация обёртки):
 *  - период режется к UTC-суткам: дедупликация награды идёт по periodStart, и
 *    неокруглённая дата давала бы вторую проводку на каждый запуск;
 *  - документ создаётся ДО кредитования, idempotencyKey привязан к id записи —
 *    иначе повтор захода удвоил бы reward-проводку в ledger;
 *  - отказ credit не роняет прогон и не помечает награду 'credited';
 *  - суб-тиковая награда (< 1e-8) не создаёт денежной операции вообще;
 *  - compensation-проход (P1 «потеря начисления»): строка, у которой документ
 *    создан, а проводка упала, остаётся `pending`, и дедуп по кортежу суток
 *    считал её готовой — деньги терялись навсегда. Теперь такие строки
 *    добираются следующим прогоном по ТОМУ ЖЕ idempotencyKey: повторная защита
 *    от двойной выплаты в сервисе отсутствует намеренно, она в ledger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReferralCalcService } from '../src/modules/referrals/application/referral-calc.service'

import type {
  CurrencySumRow,
  IReferralRepository,
  ReferredUserRow,
} from '../src/modules/referrals/domain/referral.repository'
import type { WalletFacade } from '../src/modules/wallet/facade/wallet.facade'

const REWARD_ID = 'rr-1'
const REFERRER_ID = 'partner-1'
const PLAYER_ID = 'player-1'
/** Полдень UTC: суточный бег сервиса обязан схлопнуть его в 00:00:00.000. */
const RUN_DATE = '2026-05-10T12:00:00.000Z'
const DAY_START = new Date('2026-05-10T00:00:00.000Z')
const DAY_END = new Date('2026-05-10T23:59:59.999Z')
/** Сутки раньше: compensation-проход обязан доставить их, даже когда cron
 *  сегодня считает уже «вчера» (иначе начисление потерялось бы навсегда). */
const EARLIER_DAY_START = new Date('2026-05-08T00:00:00.000Z')
const RATE = '0.05'

const sums = (...rows: CurrencySumRow[]): CurrencySumRow[] => rows

/** Суммы bet/win по валютам: ключ прогона — (userId, type). */
function sumTable(bets: CurrencySumRow[], wins: CurrencySumRow[]) {
  return (args: { userId: string; type: string }): Promise<CurrencySumRow[]> =>
    Promise.resolve(args.type === 'bet' ? bets : wins)
}

/**
 * Строка referralReward из compensation-выборки. `rewardAmount` в Prisma —
 * Decimal; сервис читает его как `.toString()`, поэтому в юните достаточно
 * строки — типизация репозитория здесь не нужна.
 */
function pendingRewardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REWARD_ID,
    referrerId: REFERRER_ID,
    referredId: PLAYER_ID,
    currency: 'RUB',
    rewardAmount: '30.00000000',
    periodStart: EARLIER_DAY_START,
    status: 'pending',
    ...overrides,
  }
}

let callLog: string[]
let findReferredUsers: ReturnType<typeof vi.fn>
let sumTransactions: ReturnType<typeof vi.fn>
let findReward: ReturnType<typeof vi.fn>
let findPendingRewards: ReturnType<typeof vi.fn>
let createReward: ReturnType<typeof vi.fn>
let updateReward: ReturnType<typeof vi.fn>
let credit: ReturnType<typeof vi.fn>
let service: ReferralCalcService

function makeService(referredUsers: ReferredUserRow[]) {
  findReferredUsers = vi.fn().mockImplementation(() => Promise.resolve(referredUsers))
  sumTransactions = vi.fn()
  findReward = vi.fn().mockImplementation(() => Promise.resolve(null))
  findPendingRewards = vi.fn().mockImplementation(() => Promise.resolve([]))
  createReward = vi.fn().mockImplementation(() => {
    callLog.push('createReward')
    return Promise.resolve({ id: REWARD_ID })
  })
  updateReward = vi.fn().mockImplementation((_id: string, data: { status: string }) => {
    callLog.push(`updateReward:${data.status}`)
    return Promise.resolve(undefined)
  })
  credit = vi.fn().mockImplementation(() => {
    callLog.push('credit')
    return Promise.resolve({ balanceAfter: '30.00000000' })
  })
  const repo = {
    findReferredUsers,
    sumTransactions,
    findReward,
    findPendingRewards,
    createReward,
    updateReward,
  }
  service = new ReferralCalcService(
    { credit } as unknown as WalletFacade,
    repo as unknown as IReferralRepository,
  )
}

beforeEach(() => {
  callLog = []
  process.env['REFERRAL_REWARD_RATE'] = RATE
  makeService([{ id: PLAYER_ID, referredBy: REFERRER_ID }])
})

afterEach(() => {
  delete process.env['REFERRAL_REWARD_RATE']
})

describe('ReferralCalcService.runDaily — happy path начисления', () => {
  it('сутки режутся к UTC-начально: periodStart/periodEnd точные, а не «когда запустились»', async () => {
    // Arrange
    sumTransactions.mockImplementation(sumTable(sums({ currency: 'RUB', amount: '1000' }), []))
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — дедупликация награды привязана к periodStart: плавающая дата = двойная выплата
    expect(result.date).toEqual(DAY_START)
    expect(findReward).toHaveBeenCalledWith({
      referrerId: REFERRER_ID,
      referredId: PLAYER_ID,
      periodStart: DAY_START,
      currency: 'RUB',
    })
    expect(createReward.mock.calls[0]?.[0]).toMatchObject({
      periodStart: DAY_START,
      periodEnd: DAY_END,
    })
  })

  it('GGR = bets − wins, награда идёт рефереру с idempotency-ключом по id записи', async () => {
    // Arrange — 1000 − 400 = 600, ставка 0.05 → 30
    sumTransactions.mockImplementation(
      sumTable(
        sums({ currency: 'RUB', amount: '1000.00000000' }),
        sums({ currency: 'RUB', amount: '400.00000000' }),
      ),
    )
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — счётчики записей (не деньги), поэтому number законен
    expect(result).toEqual({ processed: 1, credited: 1, date: DAY_START })
    expect(createReward.mock.calls[0]?.[0]).toMatchObject({
      referrerId: REFERRER_ID,
      referredId: PLAYER_ID,
      type: 'ggr_share',
      ggrAmount: '600.00000000',
      rewardRate: '0.0500',
      rewardAmount: '30.00000000',
      currency: 'RUB',
      status: 'pending',
    })
    expect(credit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: REFERRER_ID,
        currency: 'RUB',
        amount: '30.00000000',
        type: 'REFERRAL_REWARD',
        idempotencyKey: `ref_reward_${REWARD_ID}`,
        metadata: { referralRewardId: REWARD_ID, referredId: PLAYER_ID },
      }),
    )
  })

  it('порядок шагов: документ награды ДО денег, статус credited — ПОСЛЕ зачисления', async () => {
    // Arrange
    sumTransactions.mockImplementation(sumTable(sums({ currency: 'RUB', amount: '1000' }), []))
    // Act
    await service.runDaily(RUN_DATE)
    // Assert — обратный порядок означал бы «деньги без документа» или ложный статус
    expect(callLog).toEqual(['createReward', 'credit', 'updateReward:credited'])
  })

  it('отсутствующая в wins валюта считается от нуля, а не роняет прогон', async () => {
    // Arrange — ставки в двух валютах, выигрыши только в одной
    sumTransactions.mockImplementation(
      sumTable(
        sums({ currency: 'RUB', amount: '1000' }, { currency: 'USDT', amount: '500' }),
        sums({ currency: 'RUB', amount: '400' }),
      ),
    )
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — USDT: bet 500, win 0 → GGR 500 → награда 25
    expect(result.processed).toBe(2)
    expect(result.credited).toBe(2)
    const createdCurrencies: string[] = createReward.mock.calls.map(
      (call) => (call[0] as { currency: string }).currency,
    )
    expect(createdCurrencies).toEqual(['RUB', 'USDT'])
  })
})

describe('ReferralCalcService.runDaily — отказ зависимости и дедупликация', () => {
  it('повтор за те же сутки: завершенная награда не создаётся и не кредитуется', async () => {
    // Arrange — идемпотность прогона по (referrer, referred, periodStart, currency);
    // строка уже `credited`, значит compensation-проход её не касается
    sumTransactions.mockImplementation(sumTable(sums({ currency: 'RUB', amount: '1000' }), []))
    findReward.mockResolvedValue({ id: 'existing-reward', status: 'credited' })
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — второй run за день не должен двигать деньги
    expect(result).toEqual({ processed: 0, credited: 0, date: DAY_START })
    expect(createReward).not.toHaveBeenCalled()
    expect(credit).not.toHaveBeenCalled()
  })

  it('отказ кошелька: прогон не падает, награда НЕ помечается credited, соседний игрок обрабатывается', async () => {
    // Arrange
    makeService([
      { id: PLAYER_ID, referredBy: REFERRER_ID },
      { id: 'player-2', referredBy: 'partner-2' },
    ])
    sumTransactions.mockImplementation(sumTable(sums({ currency: 'RUB', amount: '1000' }), []))
    credit.mockRejectedValue(new Error('ledger deadlock'))
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — единственный обработанный сигнал неудачи: credited=0
    expect(result).toEqual({ processed: 2, credited: 0, date: DAY_START })
    expect(updateReward).not.toHaveBeenCalled()
    expect(credit).toHaveBeenCalledTimes(2)
  })

  it('отказ репозитория рефералов роняет прогон (начислений «половиной дня» быть не должно)', async () => {
    // Arrange
    sumTransactions.mockRejectedValue(new Error('game_transactions unreadable'))
    // Act/Assert
    await expect(service.runDaily(RUN_DATE)).rejects.toThrow('game_transactions unreadable')
    expect(createReward).not.toHaveBeenCalled()
  })
})

describe('ReferralCalcService.runDaily — невыплаты и краевые суммы', () => {
  it('отрицательный GGR (переиграл) → запись status zero, денег нет', async () => {
    // Arrange — wins 1500 > bets 1000
    sumTransactions.mockImplementation(
      sumTable(
        sums({ currency: 'RUB', amount: '1000' }),
        sums({ currency: 'RUB', amount: '1500' }),
      ),
    )
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — «переплата» не превращается в награду и не уходит в ledger нулём
    expect(result).toEqual({ processed: 1, credited: 0, date: DAY_START })
    expect(createReward.mock.calls[0]?.[0]).toMatchObject({
      ggrAmount: '0',
      rewardAmount: '0',
      status: 'zero',
    })
    expect(credit).not.toHaveBeenCalled()
  })

  it('награда младше 1e-8 не создаёт денежной операции', async () => {
    // Arrange — 3e-8 × 0.05 = 1.5e-9 → toFixed(8) = 0.00000000
    sumTransactions.mockImplementation(
      sumTable(sums({ currency: 'RUB', amount: '0.00000003' }), []),
    )
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — запись есть (аудит), проводки нет
    expect(result).toEqual({ processed: 1, credited: 0, date: DAY_START })
    expect(createReward.mock.calls[0]?.[0]).toMatchObject({ rewardAmount: '0.00000000' })
    expect(credit).not.toHaveBeenCalled()
    expect(updateReward).not.toHaveBeenCalled()
  })

  it('игрок без реферера не порождает ни запросов, ни начислений', async () => {
    // Arrange
    makeService([{ id: PLAYER_ID, referredBy: null }])
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert
    expect(result).toEqual({ processed: 0, credited: 0, date: DAY_START })
    expect(sumTransactions).not.toHaveBeenCalled()
    expect(findReward).not.toHaveBeenCalled()
  })
})

describe('ReferralCalcService.runDaily — compensation потерянного начисления (P1)', () => {
  it('pending-награда прошлых суток добирается: проводка и статус credited', async () => {
    // Arrange — начисление суток 08.05 упало на credit; 10.05 игрок не играл,
    // поэтому без compensation-прохода строка осталась бы `pending` навсегда
    sumTransactions.mockResolvedValue([])
    findPendingRewards.mockResolvedValue([pendingRewardRow()])
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — сумма берётся из строки награды, а не пересчитывается заново
    expect(credit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: REFERRER_ID,
        currency: 'RUB',
        amount: '30.00000000',
        type: 'REFERRAL_REWARD',
        idempotencyKey: `ref_reward_${REWARD_ID}`,
        metadata: { referralRewardId: REWARD_ID, referredId: PLAYER_ID },
      }),
    )
    expect(updateReward).toHaveBeenCalledWith(REWARD_ID, {
      status: 'credited',
      creditedAt: expect.any(Date),
    })
    expect(result).toEqual({ processed: 1, credited: 1, date: DAY_START })
  })

  it('ключ повторной попытки = ключ оригинала: второй схемы дедупликации нет, защита от двойной выплаты в ledger', async () => {
    // Arrange — забег 1: документ создан, credit упал; забег 2: строка pending в выборке
    sumTransactions.mockImplementation(sumTable(sums({ currency: 'RUB', amount: '1000' }), []))
    credit.mockRejectedValueOnce(new Error('ledger недоступен'))
    // Act — первый прогон: начисление сорвалось, награда осталась `pending`
    const firstRun = await service.runDaily(RUN_DATE)
    findPendingRewards.mockResolvedValue([pendingRewardRow({ periodStart: DAY_START })])
    findReward.mockResolvedValue({ id: REWARD_ID, status: 'pending' })
    const secondRun = await service.runDaily(RUN_DATE)
    // Assert — деньги ушли ровно один раз повторной попыткой, документ не задвоен,
    // оба вызова кредитования шли с одним и тем же idempotencyKey
    expect(firstRun).toEqual({ processed: 1, credited: 0, date: DAY_START })
    expect(secondRun).toEqual({ processed: 1, credited: 1, date: DAY_START })
    expect(createReward).toHaveBeenCalledTimes(1)
    const idempotencyKeys: string[] = credit.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    )
    expect(idempotencyKeys).toEqual([`ref_reward_${REWARD_ID}`, `ref_reward_${REWARD_ID}`])
  })

  it('отказ ledger в compensation-прогоне не роняет суточный бег и не приписывает credited', async () => {
    // Arrange
    sumTransactions.mockResolvedValue([])
    findPendingRewards.mockResolvedValue([pendingRewardRow()])
    credit.mockRejectedValue(new Error('deadlock detected'))
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — строка ждёт следующего тика, ложного статуса нет
    expect(result).toEqual({ processed: 1, credited: 0, date: DAY_START })
    expect(updateReward).not.toHaveBeenCalled()
  })

  it('нулевая награда в pending не уходит в ledger (проводка «0» не создаётся)', async () => {
    // Arrange — rate=0 или суб-тиковая доля: документ есть, денег нет
    sumTransactions.mockResolvedValue([])
    findPendingRewards.mockResolvedValue([pendingRewardRow({ rewardAmount: '0.00000000' })])
    // Act
    const result = await service.runDaily(RUN_DATE)
    // Assert — ретраивать нечего, и счётчики не надуваются на каждом тике
    expect(result).toEqual({ processed: 0, credited: 0, date: DAY_START })
    expect(credit).not.toHaveBeenCalled()
    expect(updateReward).not.toHaveBeenCalled()
  })

  it('compensation-проход идёт ДО нового расчёта и берётся ограниченным батчем', async () => {
    // Arrange
    sumTransactions.mockResolvedValue([])
    const order: string[] = []
    findPendingRewards.mockImplementation(() => {
      order.push('pendingRewards')
      return Promise.resolve([])
    })
    findReferredUsers.mockImplementation(() => {
      order.push('referredUsers')
      return Promise.resolve([])
    })
    // Act
    await service.runDaily(RUN_DATE)
    // Assert — сначала незавершённые, потом новые сутки: иначе прогон «съедает»
    // собственный дедуп по кортежу и отставшая строка не догоняется никогда
    expect(order).toEqual(['pendingRewards', 'referredUsers'])
    expect(findPendingRewards).toHaveBeenCalledWith(200)
  })
})
