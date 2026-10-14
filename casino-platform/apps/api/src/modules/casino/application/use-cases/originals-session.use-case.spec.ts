import { describe, expect, it } from 'vitest'

import { type WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { OriginalsSessionLoader, buildDemoSessionToken } from './originals-session-loader'
import { OriginalsSessionUseCase, TIGER_DEMO_START_CREDIT } from './originals-session.use-case'
import { type IDemoBalanceStore } from '../../domain/demo-balance'
import { OriginalsGameNotSupportedError, SessionInvalidError } from '../../domain/errors'
import {
  type GameSessionWithGame,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'
import { FORTUNE_TIGER_TABLES } from '../../infrastructure/providers/house/spin-data/fortune-tiger.tables'
import { QUEEN_OF_BOUNTY_TABLES } from '../../infrastructure/providers/house/spin-data/queen-of-bounty.tables'

import type { HouseSlotGameConfig, IHouseSlotGames } from '../../domain/house-slot-game'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_TOKEN = 'session_token_for_pilot_session_tests'

/** Две настоящие игры реестра: линии у них разные, путаница видна сразу. */
function makeSlotGames(): IHouseSlotGames {
  const configs: Record<string, HouseSlotGameConfig> = {
    fortunetiger: {
      externalGameId: 'fortunetiger',
      displayName: 'Fortune Tiger',
      payoutModel: 'single',
      defaultRtp: '96',
      session: FORTUNE_TIGER_TABLES.session,
      winRows: FORTUNE_TIGER_TABLES.winRows as HouseSlotGameConfig['winRows'],
      loseRows: FORTUNE_TIGER_TABLES.loseRows as HouseSlotGameConfig['loseRows'],
      icons: { success: true, data: [], message: 'List icons success' },
    },
    queenofbounty: {
      externalGameId: 'queenofbounty',
      displayName: 'Queen of Bounty',
      payoutModel: 'lines',
      defaultRtp: '96',
      session: QUEEN_OF_BOUNTY_TABLES.session,
      winRows: QUEEN_OF_BOUNTY_TABLES.winRows as HouseSlotGameConfig['winRows'],
      loseRows: QUEEN_OF_BOUNTY_TABLES.loseRows as HouseSlotGameConfig['loseRows'],
      icons: { success: true, data: [], message: 'List icons success' },
    },
  }
  return { getGameConfig: (id: string) => configs[id] ?? null }
}

/** Минимальный фейк: загрузчик читает сессию и трогает её, остальное не нужно. */
function makePlayRepository(session: GameSessionWithGame | null): {
  repository: IGamePlayRepository
  touches: () => number
} {
  let touched = 0
  const repository = {
    findSessionByTokenWithGame: () => Promise.resolve(session),
    touchSession: () => {
      touched += 1
      return Promise.resolve()
    },
  } as unknown as IGamePlayRepository
  return { repository, touches: () => touched }
}

function makeWallet(available: string): WalletFacade {
  return {
    getBalance: () => Promise.resolve({ available, locked: '0.00' }),
  } as unknown as WalletFacade
}

function makeSession(externalGameId: string, status = 'active'): GameSessionWithGame {
  return {
    id: 'session-1',
    userId: USER_ID,
    currency: 'RUB',
    status,
    game: { externalGameId },
  } as unknown as GameSessionWithGame
}

/**
 * Двойник демо-счёта: этот путь только читает остаток, списаний в нём нет.
 */
function makeDemoBalance(overrides: Record<string, string> = {}): IDemoBalanceStore {
  return {
    settle: async () => ({ accepted: true, balance: '0' }),
    peek: async (sessionToken: string, startCredit: string) =>
      overrides[sessionToken] ?? startCredit,
  }
}

describe('OriginalsSessionUseCase', () => {
  it('демо берёт idle-блок игры из токена, а не единственной игры каталога', async () => {
    const useCase = new OriginalsSessionUseCase(
      new OriginalsSessionLoader(makePlayRepository(null).repository, makeSlotGames()),
      makeWallet('0.00'),
      makeDemoBalance(),
    )

    const data = await useCase.execute(buildDemoSessionToken('queenofbounty'))

    expect(data.num_line).toBe(QUEEN_OF_BOUNTY_TABLES.session.numLine)
    expect(data.line_num).toBe(QUEEN_OF_BOUNTY_TABLES.session.numLine)
    expect(data.num_line).not.toBe(FORTUNE_TIGER_TABLES.session.numLine)
    expect(data.credit).toBe(Number(TIGER_DEMO_START_CREDIT))
    expect(data.user_name).toBe('Guest')
  })

  it('демо показывает наигранный остаток, а не стартовые 1000 при каждой перезаходе', async () => {
    const token = buildDemoSessionToken('fortunetiger')
    const useCase = new OriginalsSessionUseCase(
      new OriginalsSessionLoader(makePlayRepository(null).repository, makeSlotGames()),
      makeWallet('0.00'),
      makeDemoBalance({ [token]: '1470.50' }),
    )

    const data = await useCase.execute(token)

    expect(data.credit).toBe(1470.5)
    expect(data.credit).not.toBe(Number(TIGER_DEMO_START_CREDIT))
  })

  it('бой: кредит из кошелька с двумя знаками, имя — короткий ID, линии — из игры сессии', async () => {
    const play = makePlayRepository(makeSession('fortunetiger'))
    const useCase = new OriginalsSessionUseCase(
      new OriginalsSessionLoader(play.repository, makeSlotGames()),
      makeWallet('12.3456'),
      makeDemoBalance(),
    )

    const data = await useCase.execute(SESSION_TOKEN)

    expect(data.credit).toBe(12.35)
    expect(data.num_line).toBe(FORTUNE_TIGER_TABLES.session.numLine)
    expect(data.user_name).toBe(`Player ${USER_ID.slice(0, 8)}`)
    expect(data.currency_prefix).toBe('RUB')
    expect(play.touches()).toBe(1)
  })

  it('неактивная сессия — та же ошибка, что и на путях спина', async () => {
    const play = makePlayRepository(makeSession('fortunetiger', 'closed'))
    const useCase = new OriginalsSessionUseCase(
      new OriginalsSessionLoader(play.repository, makeSlotGames()),
      makeWallet('100.00'),
      makeDemoBalance(),
    )

    await expect(useCase.execute(SESSION_TOKEN)).rejects.toBeInstanceOf(SessionInvalidError)
    expect(play.touches()).toBe(0)
  })

  it('ответ не делит массивы с таблицами реестра: правка ответа не трогает следующую сессию', async () => {
    const loader = new OriginalsSessionLoader(makePlayRepository(null).repository, makeSlotGames())
    const useCase = new OriginalsSessionUseCase(loader, makeWallet('0.00'), makeDemoBalance())
    const token = buildDemoSessionToken('fortunetiger')

    const first = await useCase.execute(token)
    first.icon_data.length = 0
    first.active_lines.length = 0
    first.bet_size_list.length = 0

    const second = await useCase.execute(token)
    expect(second.icon_data).toEqual(FORTUNE_TIGER_TABLES.session.iconData)
    expect(second.active_lines).toHaveLength(FORTUNE_TIGER_TABLES.session.activeLines.length)
    expect(second.bet_size_list).toEqual(FORTUNE_TIGER_TABLES.session.betSizeList)
  })

  it('демо-токен игры вне реестра и токен без игры — разные ошибки', async () => {
    const useCase = new OriginalsSessionUseCase(
      new OriginalsSessionLoader(makePlayRepository(null).repository, makeSlotGames()),
      makeWallet('0.00'),
      makeDemoBalance(),
    )

    await expect(useCase.execute(buildDemoSessionToken('aztec'))).rejects.toBeInstanceOf(
      OriginalsGameNotSupportedError,
    )
    await expect(useCase.execute('demo_')).rejects.toBeInstanceOf(SessionInvalidError)
  })
})
