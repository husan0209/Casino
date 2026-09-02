/**
 * Интеграционный тест реферальных начислений на реальном Postgres (GAP-32).
 *
 * Запускаются ТОЛЬКО при LEDGER_INTEGRATION=1 (в CI: job lint-typecheck-test
 * поднимает postgres + применяет МИГРАЦИИ — GAP-31). Локально скипаются.
 *
 * Структура как в ledger.integration.spec.ts: describe-колбэк НЕ async,
 * весь бизнес-код внутри it() — иначе Prisma-движок грузился бы на ARM.
 *
 * Критерии GAP-32:
 * 2) игрок с GGR>0 → в ledger_entries есть REFERRAL_REWARD (ggr × rate),
 *    referral_rewards.status='credited';
 * 3) повторный запуск за тот же день не создаёт вторую проводку;
 * 4) день без GGR → статус zero, проводок нет.
 */
import { randomUUID } from 'crypto'

import { prisma } from '@casino/database'

import { WalletFacade } from '../src/modules/wallet/application/wallet.facade'
import { PrismaWalletLedger } from '../src/modules/wallet/infrastructure/ledger/wallet.ledger.prisma'
import { PrismaReferralRepository } from '../src/modules/referrals/infrastructure/referral.prisma.repository'
import { ReferralCalcService } from '../src/modules/referrals/application/referral-calc.service'

const INTEGRATION = process.env['LEDGER_INTEGRATION'] === '1'
const dDb = INTEGRATION ? describe : describe.skip

const ledger = new PrismaWalletLedger()
// Credit только проксирует ledger (WalletFacade.credit → ledger.credit) —
// остальные зависимости фасада в этом тесте не используются.
const walletFacade = new WalletFacade(
  ledger,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
)
const calc = new ReferralCalcService(walletFacade, new PrismaReferralRepository())

const userIds: string[] = []
let providerId = ''
let gameId = ''
let sessionId = ''
let roundId = ''

async function makeUser(referredBy?: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      referralCode: ('rg' + randomUUID()).slice(0, 32),
      ...(referredBy ? { referredBy } : {}),
    },
  })
  userIds.push(u.id)
  return u.id
}

async function makeRound(userId: string) {
  const [provider] = await Promise.all([
    prisma.gameProvider.create({
      data: { slug: 'rg-' + randomUUID().slice(0, 12), name: 'RG provider', type: 'slots' },
    }),
  ])
  providerId = provider.id
  const game = await prisma.game.create({
    data: {
      providerId,
      externalGameId: 'rg-' + randomUUID().slice(0, 12),
      slug: 'rg-' + randomUUID().slice(0, 12),
      name: 'RG game',
      type: 'slot',
      category: 'slots',
    },
  })
  gameId = game.id
  const session = await prisma.gameSession.create({
    data: { userId, gameId, providerId, sessionToken: 'rg-' + randomUUID(), currency: 'RUB' },
  })
  sessionId = session.id
  const round = await prisma.gameRound.create({
    data: {
      sessionId,
      userId,
      gameId,
      providerId,
      externalRoundId: 'rg-' + randomUUID().slice(0, 12),
      currency: 'RUB',
    },
  })
  roundId = round.id
}

/** bet/win транзакции в пределах «сегодня» (UTC) — день для runDaily. */
async function addGameTx(userId: string, type: 'bet' | 'win', amount: string) {
  await prisma.gameTransaction.create({
    data: {
      roundId,
      sessionId,
      userId,
      providerId,
      type,
      externalTransactionId: 'rg-' + randomUUID(),
      amount,
      currency: 'RUB',
      balanceAfter: '0',
    },
  })
}

afterAll(async () => {
  // LedgerEntry.user FK без cascade — чистим руками, потом FK-цепочку
  for (const id of userIds) {
    await prisma.ledgerEntry.deleteMany({ where: { userId: id } })
  }
  if (roundId) {
    await prisma.gameTransaction.deleteMany({ where: { roundId } })
    await prisma.gameRound.delete({ where: { id: roundId } }).catch(() => {})
  }
  if (sessionId) {
    await prisma.gameSession.delete({ where: { id: sessionId } }).catch(() => {})
  }
  if (gameId) {
    await prisma.game.delete({ where: { id: gameId } }).catch(() => {})
  }
  if (providerId) {
    await prisma.gameProvider.delete({ where: { id: providerId } }).catch(() => {})
  }
  await prisma.referralReward
    .deleteMany({ where: { referrerId: { in: userIds } } })
    .catch(() => {})
  for (const id of userIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {})
  }
})

dDb('referral daily payout (real Postgres, GAP-32)', () => {
  it('GGR>0 → проводка REFERRAL_REWARD (ggr×rate) + referral_rewards.status=credited', async () => {
    const referrerId = await makeUser()
    const referredId = await makeUser(referrerId)
    await makeRound(referredId)
    await addGameTx(referredId, 'bet', '100')
    await addGameTx(referredId, 'win', '20')
    // GGR = 100 - 20 = 80; rate default 0.05 → reward 4.00

    const today = new Date().toISOString().slice(0, 10)
    const res = await calc.runDaily(today)

    expect(res.credited).toBe(1)
    const reward = await prisma.referralReward.findFirst({
      where: { referrerId, referredId, periodStart: { gte: new Date(today + 'T00:00:00.000Z') } },
    })
    expect(reward).not.toBeNull()
    expect(reward!.status).toBe('credited')
    expect(reward!.rewardAmount.toString()).toBe('4')

    const entry = await prisma.ledgerEntry.findFirst({
      where: { userId: referrerId, type: 'REFERRAL_REWARD' },
    })
    expect(entry).not.toBeNull()
    expect(entry!.amount.toString()).toBe('4')
    expect(entry!.idempotencyKey).toBe(`ref_reward_${reward!.id}`)
  })

  it('повторный запуск за тот же день не создаёт вторую проводку (критерий 3)', async () => {
    const referrerId = await makeUser()
    const referredId = await makeUser(referrerId)
    await makeRound(referredId)
    await addGameTx(referredId, 'bet', '100')
    await addGameTx(referredId, 'win', '20')

    const today = new Date().toISOString().slice(0, 10)
    await calc.runDaily(today)
    const res2 = await calc.runDaily(today)

    expect(res2.credited).toBe(0)
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: referrerId, type: 'REFERRAL_REWARD' },
    })
    expect(entries).toHaveLength(1)
  })

  it('день без GGR (win > bet) → статус zero, проводок нет (критерий 4)', async () => {
    const referrerId = await makeUser()
    const referredId = await makeUser(referrerId)
    await makeRound(referredId)
    await addGameTx(referredId, 'bet', '10')
    await addGameTx(referredId, 'win', '50') // GGR = -40

    const today = new Date().toISOString().slice(0, 10)
    const res = await calc.runDaily(today)

    const reward = await prisma.referralReward.findFirst({
      where: { referrerId, referredId, periodStart: { gte: new Date(today + 'T00:00:00.000Z') } },
    })
    expect(reward).not.toBeNull()
    expect(reward!.status).toBe('zero')
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: referrerId, type: 'REFERRAL_REWARD' },
    })
    expect(entries).toHaveLength(0)
  })
})
