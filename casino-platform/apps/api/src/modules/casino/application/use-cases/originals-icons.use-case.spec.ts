import { describe, expect, it } from 'vitest'

import { OriginalsIconsUseCase } from './originals-icons.use-case'
import { OriginalsSessionLoader, buildDemoSessionToken } from './originals-session-loader'
import { OriginalsGameNotSupportedError, SessionInvalidError } from '../../domain/errors'
import {
  type GameSessionWithGame,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'
import { FORTUNE_TIGER_TABLES } from '../../infrastructure/providers/house/spin-data/fortune-tiger.tables'
import { QUEEN_OF_BOUNTY_TABLES } from '../../infrastructure/providers/house/spin-data/queen-of-bounty.tables'

import type { HouseSlotGameConfig, IHouseSlotGames } from '../../domain/house-slot-game'

const SESSION_TOKEN = 'session_token_for_pilot_icons_tests'

/** Та же игра, что в сессии, но paytable у каждой свои — их и сверяем. */
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
      icons: FORTUNE_TIGER_TABLES.icons as unknown as HouseSlotGameConfig['icons'],
    },
    queenofbounty: {
      externalGameId: 'queenofbounty',
      displayName: 'Queen of Bounty',
      payoutModel: 'lines',
      defaultRtp: '96',
      session: QUEEN_OF_BOUNTY_TABLES.session,
      winRows: QUEEN_OF_BOUNTY_TABLES.winRows as HouseSlotGameConfig['winRows'],
      loseRows: QUEEN_OF_BOUNTY_TABLES.loseRows as HouseSlotGameConfig['loseRows'],
      icons: QUEEN_OF_BOUNTY_TABLES.icons as unknown as HouseSlotGameConfig['icons'],
    },
  }
  return { getGameConfig: (id: string) => configs[id] ?? null }
}

function makePlayRepository(session: GameSessionWithGame | null): IGamePlayRepository {
  return {
    findSessionByTokenWithGame: () => Promise.resolve(session),
    touchSession: () => Promise.resolve(),
  } as unknown as IGamePlayRepository
}

function makeSession(externalGameId: string): GameSessionWithGame {
  return {
    id: 'session-1',
    userId: 'user-1',
    currency: 'RUB',
    status: 'active',
    game: { externalGameId },
  } as unknown as GameSessionWithGame
}

describe('OriginalsIconsUseCase', () => {
  it('демо отдаёт paytable игры из токена: таблицы соседнего слота не подставляются', async () => {
    const useCase = new OriginalsIconsUseCase(
      new OriginalsSessionLoader(makePlayRepository(null), makeSlotGames()),
    )

    const tiger = await useCase.execute(buildDemoSessionToken('fortunetiger'))
    const queen = await useCase.execute(buildDemoSessionToken('queenofbounty'))

    expect(tiger.data[0]?.win_3).toBe(250)
    expect(queen.data[0]?.win_3).toBe(0)
    expect(tiger.data).not.toEqual(queen.data)
  })

  it('бой: paytable берётся из игры сессии', async () => {
    const useCase = new OriginalsIconsUseCase(
      new OriginalsSessionLoader(makePlayRepository(makeSession('queenofbounty')), makeSlotGames()),
    )

    const doc = await useCase.execute(SESSION_TOKEN)

    expect(doc.success).toBe(true)
    expect(doc.data.map((row) => row.icon_name)).toEqual(
      (QUEEN_OF_BOUNTY_TABLES.icons.data as { icon_name: string }[]).map((row) => row.icon_name),
    )
  })

  it('сессия закрыта, игра вне реестра и токен без игры — ошибки разные', async () => {
    const closed = {
      findSessionByTokenWithGame: () =>
        Promise.resolve({ id: 's', status: 'closed', game: { externalGameId: 'fortunetiger' } }),
      touchSession: () => Promise.resolve(),
    } as unknown as IGamePlayRepository
    const useCase = new OriginalsIconsUseCase(new OriginalsSessionLoader(closed, makeSlotGames()))

    await expect(useCase.execute(SESSION_TOKEN)).rejects.toBeInstanceOf(SessionInvalidError)
    await expect(useCase.execute(buildDemoSessionToken('aztec'))).rejects.toBeInstanceOf(
      OriginalsGameNotSupportedError,
    )
    await expect(useCase.execute('demo_')).rejects.toBeInstanceOf(SessionInvalidError)
  })
})
