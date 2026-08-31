/**
 * Интеграционные тесты game-round фикстур на реальном Postgres (P2 #13).
 *
 * Вопрос трекера: Prisma `Decimal` increment СТРОКОЙ (`{ totalBet: { increment: cb.betAmount } }`,
 * где betAmount — строка из парсинга коллбэка провайдера) — работает ли на реальной БД,
 * или нужен Decimal? Тест фиксирует рантайм-поведение.
 *
 * Запуск — как у ledger.integration.spec.ts: LEDGER_INTEGRATION=1 (CI), локально скип.
 */
import { randomUUID } from 'crypto'

import { prisma } from '@casino/database'

const INTEGRATION = process.env['LEDGER_INTEGRATION'] === '1'
const dDb = INTEGRATION ? describe : describe.skip

let userId = ''
let providerId = ''
let gameId = ''
let sessionId = ''
let roundId = ''

async function seedRoundChain(): Promise<void> {
  const user = await prisma.user.create({
    data: { referralCode: ('gr' + randomUUID()).slice(0, 32) },
  })
  userId = user.id
  const provider = await prisma.gameProvider.create({
    data: { slug: 'it-' + randomUUID().slice(0, 12), name: 'IT provider', type: 'slots' },
  })
  providerId = provider.id
  const game = await prisma.game.create({
    data: {
      providerId,
      externalGameId: 'it-' + randomUUID().slice(0, 12),
      slug: 'it-' + randomUUID().slice(0, 12),
      name: 'IT game',
      type: 'slot',
      category: 'slots',
    },
  })
  gameId = game.id
  const session = await prisma.gameSession.create({
    data: {
      userId,
      gameId,
      providerId,
      sessionToken: 'it-' + randomUUID(),
      currency: 'RUB',
    },
  })
  sessionId = session.id
  const round = await prisma.gameRound.create({
    data: {
      sessionId,
      userId,
      gameId,
      providerId,
      externalRoundId: 'it-' + randomUUID().slice(0, 12),
      currency: 'RUB',
    },
  })
  roundId = round.id
}

afterAll(async () => {
  // порядок: транзакции → раунды → сессии → игры → провайдер → юзер
  if (roundId) {
    await prisma.gameTransaction.deleteMany({ where: { roundId } })
  }
  if (sessionId) {
    await prisma.gameRound.deleteMany({ where: { sessionId } })
    await prisma.gameSession.delete({ where: { id: sessionId } }).catch(() => {})
  }
  if (gameId) {
    await prisma.game.delete({ where: { id: gameId } }).catch(() => {})
  }
  if (providerId) {
    await prisma.gameProvider.delete({ where: { id: providerId } }).catch(() => {})
  }
  if (userId) {
    await prisma.ledgerEntry.deleteMany({ where: { userId } })
    await prisma.walletAccount.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } }).catch(() => {})
  }
})

dDb('game round: Decimal increment строкой (P2 #13)', () => {
  it('increment totalBet строкой из провайдерского коллбэка работает', async () => {
    await seedRoundChain()
    // ровно тот вызов, что делает game-callback.service.ts в bet
    await prisma.gameRound.update({
      where: { id: roundId },
      data: { totalBet: { increment: '10.50' } },
    })
    // второй инкремент — накопление без потери точности
    await prisma.gameRound.update({
      where: { id: roundId },
      data: { totalBet: { increment: '0.25' } },
    })
    const round = await prisma.gameRound.findUnique({ where: { id: roundId } })
    expect(round?.totalBet.toString()).toBe('10.75')
  })

  it('GameTransaction с Decimal-строками пишется и читается (bet в раунде)', async () => {
    const tx = await prisma.gameTransaction.create({
      data: {
        roundId,
        sessionId,
        userId,
        providerId,
        type: 'bet',
        externalTransactionId: 'it-' + randomUUID(),
        amount: '10.50',
        currency: 'RUB',
        balanceAfter: '989.50',
      },
    })
    const read = await prisma.gameTransaction.findUnique({ where: { id: tx.id } })
    expect(read?.amount.toString()).toBe('10.5')
    expect(read?.balanceAfter.toString()).toBe('989.5')
  })
})
