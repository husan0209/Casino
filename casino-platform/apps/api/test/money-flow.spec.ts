import type { Prisma } from '@prisma/client'

import { GameCallbackService } from '../src/modules/casino/application/services/game-callback.service'
import type {
  GameRow,
  GameSessionWithGame,
  GameTransactionRow,
  IGamePlayRepository,
} from '../src/modules/casino/domain/repositories/casino.repository'
import type { ParsedProviderCallback } from '../src/modules/casino/domain/provider-adapter.interface'
import type { WalletFacade } from '../src/modules/wallet/application/wallet.facade'
import type { CreditInput, CreditResult } from '../src/modules/wallet/domain/repositories/wallet.repository'

/** Маркер транзакции: в тестах вместо Prisma.TransactionClient. */
const TX = { __tx: 'outer-transaction' } as unknown as Prisma.TransactionClient

function cb(overrides: Partial<ParsedProviderCallback>): ParsedProviderCallback {
  return { action: 'bet', rawRequest: {}, ...overrides }
}

const SESSION: GameSessionWithGame = {
  id: 'session-1',
  userId: 'user-1',
  gameId: 'game-1',
  sessionToken: 'tok',
  currency: 'RUB',
  status: 'active',
  providerId: 'prov',
  game: { id: 'game-1', name: 'Slots' },
} as unknown as GameSessionWithGame

interface WalletCall {
  op: 'credit' | 'debit'
  input: CreditInput
}

/** In-memory реализация IGamePlayRepository — только то, что читает сервис. */
class FakePlay implements IGamePlayRepository {
  sessions = new Map<string, GameSessionWithGame>()
  rounds = new Map<string, GameRow>()
  transactions = new Map<string, GameTransactionRow>() // key: providerId:externalId
  rollbacks: GameTransactionRow[] = []
  /** tx, с которым был вызван каждый метод (для атомарных assertions). */
  txSeen: Record<string, unknown[]> = {}

  private record(method: string, tx: Prisma.TransactionClient | undefined) {
    ;(this.txSeen[method] ??= []).push(tx)
  }

  async findSessionByTokenWithUser(token: string) {
    return this.sessions.get(token) ?? null
  }
  async findSessionByTokenWithGame(token: string) {
    return this.sessions.get(token) ?? null
  }
  async findSessionByToken(token: string) {
    return this.sessions.get(token) ?? null
  }
  async closeActiveSessions(): Promise<void> {}
  async createSession(data: Prisma.GameSessionUncheckedCreateInput) {
    return { id: 'session-1', sessionToken: String(data.sessionToken) }
  }
  async touchSession(): Promise<void> {}
  async addSessionBet(id: string, _amount: string, tx?: Prisma.TransactionClient) {
    this.record('addSessionBet', tx)
  }
  async addSessionWin(id: string, _amount: string, tx?: Prisma.TransactionClient) {
    this.record('addSessionWin', tx)
  }
  async findRoundByExternal(
    providerId: string,
    externalRoundId: string,
    tx?: Prisma.TransactionClient,
  ) {
    this.record('findRoundByExternal', tx)
    return this.rounds.get(`${providerId}:${externalRoundId}`) ?? null
  }
  async createRound(data: Prisma.GameRoundUncheckedCreateInput, tx?: Prisma.TransactionClient) {
    this.record('createRound', tx)
    const row = { id: 'round-1', ...data } as unknown as GameRow
    this.rounds.set(`${data.providerId}:${data.externalRoundId}`, row)
    return row
  }
  async updateRound(
    id: string,
    data: Prisma.GameRoundUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    this.record('updateRound', tx)
    void id
    void data
  }
  async findTransactionByExternal(
    providerId: string,
    externalTransactionId: string,
    tx?: Prisma.TransactionClient,
  ) {
    this.record('findTransactionByExternal', tx)
    return this.transactions.get(`${providerId}:${externalTransactionId}`) ?? null
  }
  async findRollbackOf(
    roundId: string,
    rollbackOfId: string,
    tx?: Prisma.TransactionClient,
  ) {
    this.record('findRollbackOf', tx)
    return this.rollbacks.find((r) => r.roundId === roundId) ?? null
  }
  async createTransaction(
    data: Prisma.GameTransactionUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    this.record('createTransaction', tx)
    const row = { id: 'gt-1', ...data } as unknown as GameTransactionRow
    this.transactions.set(`${data.providerId}:${data.externalTransactionId}`, row)
    if (data.type === 'rollback') this.rollbacks.push(row)
    return row
  }
}

class FakeWallet {
  calls: WalletCall[] = []

  private result(): CreditResult {
    return { balanceBefore: '100', balanceAfter: '90', ledgerEntryId: 'led-1', duplicate: false }
  }
  async credit(input: CreditInput) {
    this.calls.push({ op: 'credit', input })
    return this.result()
  }
  async debit(input: CreditInput) {
    this.calls.push({ op: 'debit', input })
    // имитация InsufficientFundsError из реального ledger (проверка available)
    if (Number(input.amount) >= 999999) {
      throw new Error('INSUFFICIENT_FUNDS')
    }
    return this.result()
  }
  async getBalance() {
    return { currency: 'RUB', balance: '100', locked: '0', available: '100' }
  }
  /** Тот же контракт, что WalletFacade.runInTransaction: один tx на весь колбэк. */
  async runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return fn(TX)
  }
}

function makeService() {
  const play = new FakePlay()
  const wallet = new FakeWallet()
  const svc = new GameCallbackService(wallet as unknown as WalletFacade, play)
  play.sessions.set('tok', SESSION)
  return { svc, play, wallet }
}

const BET = cb({
  action: 'bet',
  playerToken: 'tok',
  transactionId: 'tx-1',
  betAmount: '10',
  roundId: 'round-ext-1',
})

describe('GAP-24 money flow: bet/win/rollback (idempotency, types, atomicity)', () => {
  it('bet: дебетует и пишет gameTransaction в ОДНОЙ транзакции (одинаковый tx)', async () => {
    const { svc, play, wallet } = makeService()
    const res = await svc.bet(BET, 'prov')
    expect(res).toEqual({ balance: '90', duplicate: false })
    expect(wallet.calls).toHaveLength(1)
    expect(wallet.calls[0]).toMatchObject({ op: 'debit', input: { amount: '10', type: 'BET' } })
    expect(wallet.calls[0]!.input.tx).toBe(TX)
    // все записи внутри tx — атомарность структурно гарантирована
    expect(play.txSeen['createTransaction']).toEqual([TX])
    expect(play.txSeen['updateRound']).toEqual([TX])
    expect(play.txSeen['addSessionBet']).toEqual([TX])
  })

  it('bet: повторный transactionId → duplicate без повторного списания', async () => {
    const { svc, wallet } = makeService()
    await svc.bet(BET, 'prov')
    const res = await svc.bet(BET, 'prov')
    expect(res.duplicate).toBe(true)
    expect(wallet.calls).toHaveLength(1) // debit только один раз
  })

  it('bet: недостаток средств — ошибка выходит из runInTransaction (в проде tx откатится)', async () => {
    const { svc } = makeService()
    const big = cb({ ...BET, betAmount: '999999' })
    await expect(svc.bet(big, 'prov')).rejects.toThrow('INSUFFICIENT_FUNDS')
  })

  it('win с суммой > 0: кредитует и закрывает раунд', async () => {
    const { svc, wallet } = makeService()
    await svc.bet(BET, 'prov')
    wallet.calls.length = 0
    const res = await svc.win(
      cb({ action: 'win', playerToken: 'tok', transactionId: 'tx-w1', winAmount: '25' }),
      'prov',
    )
    expect(res.duplicate).toBe(false)
    expect(wallet.calls).toHaveLength(1)
    expect(wallet.calls[0]).toMatchObject({ op: 'credit', input: { amount: '25', type: 'WIN' } })
    expect(wallet.calls[0]!.input.tx).toBe(TX)
  })

  it('win с суммой 0: проводка пишется, кошелёк не трогается', async () => {
    const { svc, wallet } = makeService()
    const res = await svc.win(
      cb({ action: 'win', playerToken: 'tok', transactionId: 'tx-w0', winAmount: '0' }),
      'prov',
    )
    expect(wallet.calls).toHaveLength(0)
    expect(res.duplicate).toBe(false)
  })

  it('rollback ставки → CREDIT (возврат списания), не дебет', async () => {
    const { svc, play, wallet } = makeService()
    await svc.bet(BET, 'prov')
    wallet.calls.length = 0
    const res = await svc.rollback(
      cb({ action: 'rollback', playerToken: 'tok', rollbackTransactionId: 'tx-1' }),
      'prov',
    )
    expect(res).toMatchObject({ balance: '90' })
    expect(wallet.calls).toHaveLength(1)
    expect(wallet.calls[0]!.op).toBe('credit') // bet откатывается возвратом
    expect(wallet.calls[0]!.input.tx).toBe(TX)
    const rb = play.rollbacks[0]
    expect(rb.type).toBe('rollback')
  })

  it('rollback выигрыша → DEBIT (забрать выплату обратно)', async () => {
    const { svc, wallet } = makeService()
    await svc.bet(BET, 'prov')
    await svc.win(
      cb({ action: 'win', playerToken: 'tok', transactionId: 'tx-w1', winAmount: '25' }),
      'prov',
    )
    wallet.calls.length = 0
    await svc.rollback(
      cb({ action: 'rollback', playerToken: 'tok', rollbackTransactionId: 'tx-w1' }),
      'prov',
    )
    expect(wallet.calls).toHaveLength(1)
    expect(wallet.calls[0]!.op).toBe('debit') // win откатывается изъятием
  })

  it('rollback отката → CANNOT_ROLLBACK_A_ROLLBACK (rollbackTransactionId указывает на rollback)', async () => {
    const { svc, play, wallet } = makeService()
    // сажаем rollback-транзакцию напрямую: provider шлёт rollbackTransactionId,
    // указывающий на rollback (findRollbackOf по ней ничего не находит)
    play.transactions.set('prov:rb-1', {
      id: 'gt-rb',
      roundId: 'round-1',
      type: 'rollback',
      externalTransactionId: 'rb-1',
      amount: '10',
    } as unknown as GameTransactionRow)
    await expect(
      svc.rollback(
        cb({ action: 'rollback', playerToken: 'tok', rollbackTransactionId: 'rb-1' }),
        'prov',
      ),
    ).rejects.toThrow('CANNOT_ROLLBACK_A_ROLLBACK')
    expect(wallet.calls).toHaveLength(0)
  })

  it('rollback фантомной транзакции → phantom без движения денег', async () => {
    const { svc, wallet } = makeService()
    const res = await svc.rollback(
      cb({ action: 'rollback', playerToken: 'tok', rollbackTransactionId: 'nope' }),
      'prov',
    )
    expect(res).toMatchObject({ phantom: true })
    expect(wallet.calls).toHaveLength(0)
  })

  it('rollback: повторный → duplicate без второй проводки', async () => {
    const { svc, wallet } = makeService()
    await svc.bet(BET, 'prov')
    await svc.rollback(
      cb({ action: 'rollback', playerToken: 'tok', rollbackTransactionId: 'tx-1' }),
      'prov',
    )
    wallet.calls.length = 0
    const res = await svc.rollback(
      cb({ action: 'rollback', playerToken: 'tok', rollbackTransactionId: 'tx-1' }),
      'prov',
    )
    expect(res.duplicate).toBe(true)
    expect(wallet.calls).toHaveLength(0)
  })

  it('фейковая реплика идемпотентна по providerId+externalTransactionId', async () => {
    const { svc } = makeService()
    await svc.bet(BET, 'prov')
    // тот же transactionId от другого провайдера — отдельная транзакция
    const res = await svc.bet(
      cb({ ...BET, transactionId: 'tx-2', playerToken: 'tok' }),
      'other-prov',
    )
    expect(res.duplicate).toBe(false)
  })
})
