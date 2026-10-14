import { randomBytes } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'

import { OriginalsGameNotSupportedError, SessionInvalidError } from '../../domain/errors'
import {
  HOUSE_SLOT_GAMES,
  type HouseSlotGameConfig,
  type IHouseSlotGames,
} from '../../domain/house-slot-game'
import {
  GAME_PLAY_REPOSITORY,
  type GameSessionWithGame,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'

/** External ID первой игры пилота (Fortune Tiger). */
export const TIGER_EXTERNAL_GAME_ID = 'fortunetiger'

/** External ID Plinko (второй пилот, свой протокол — не через реестр слотов). */
export const PLINKO_EXTERNAL_GAME_ID = 'plinko'

/**
 * External ID Aztec: третья house-игра со своим клиентом. Её таблицы не
 * перенесены из донора, а написаны заново (domain/aztec-game), поэтому она
 * не в реестре слотов, а рядом с Plinko.
 */
export const AZTEC_EXTERNAL_GAME_ID = 'treasuresofaztec'

/** Префикс токенов демо-запуска (launch без сессии, см. LaunchGameUseCase). */
export const DEMO_TOKEN_PREFIX = 'demo_'

/**
 * Токен демо-запуска. Сессии у демо нет, а фронт Construct знает только токен —
 * поэтому externalGameId зашит в сам токен: без него демо крутило бы таблицы
 * одной игры на всех слотах каталога.
 */
export function buildDemoSessionToken(gameExternalId: string): string {
  return `${DEMO_TOKEN_PREFIX}${gameExternalId}_${randomBytes(16).toString('hex')}`
}

/** ExternalGameId из демо-токена; null — не демо или пустая игра. */
export function parseDemoSessionGameId(sessionToken: string): string | null {
  if (!sessionToken.startsWith(DEMO_TOKEN_PREFIX)) {
    return null
  }
  const gameExternalId = sessionToken.slice(DEMO_TOKEN_PREFIX.length).split('_')[0]
  return gameExternalId ? gameExternalId : null
}

/**
 * Общая загрузка активных сессий house-игр для vgames/plinko-эндпоинтов.
 * Сессия уже создана штатным launch-флоу; токен = capability (как HMAC
 * у внешних провайдеров), отдельной авторизации не требуется.
 * Имя игрока намеренно не тянем из users-модуля (расширение чужого
 * фасада — только с одобрения владельца): показываем короткий ID.
 */
@Injectable()
export class OriginalsSessionLoader {
  constructor(
    @Inject(GAME_PLAY_REPOSITORY) private readonly play: IGamePlayRepository,
    @Inject(HOUSE_SLOT_GAMES) private readonly slotGames: IHouseSlotGames,
  ) {}

  /**
   * Слот house-каталога: сессия + конфиг таблиц по игре сессии.
   * Неизвестная реестру игра — 501 (новый слот сначала в реестр).
   */
  async loadActiveSlotSession(
    sessionToken: string,
  ): Promise<{ session: GameSessionWithGame; game: HouseSlotGameConfig }> {
    const session = await this.play.findSessionByTokenWithGame(sessionToken)
    if (session?.status !== 'active') {
      throw new SessionInvalidError()
    }
    const game = this.slotGames.getGameConfig(session.game.externalGameId)
    if (!game) {
      throw new OriginalsGameNotSupportedError(session.game.externalGameId)
    }
    await this.play.touchSession(session.id)
    return { session, game }
  }

  /**
   * Конфиг слота для демо-токена: игра берётся из самого токена, сессии в демо нет.
   * Токен без игры (старый формат) или игра вне реестра — та же ошибка, что и
   * на боевом пути: демо не должно молча крутить чужие таблицы.
   */
  loadDemoSlotGame(sessionToken: string): HouseSlotGameConfig {
    const gameExternalId = parseDemoSessionGameId(sessionToken)
    if (!gameExternalId) {
      throw new SessionInvalidError()
    }
    const game = this.slotGames.getGameConfig(gameExternalId)
    if (!game) {
      throw new OriginalsGameNotSupportedError(gameExternalId)
    }
    return game
  }

  async loadActiveHouseSession(
    sessionToken: string,
    expectedGameId: string,
  ): Promise<GameSessionWithGame> {
    const session = await this.play.findSessionByTokenWithGame(sessionToken)
    if (session?.status !== 'active') {
      throw new SessionInvalidError()
    }
    if (session.game.externalGameId !== expectedGameId) {
      throw new OriginalsGameNotSupportedError(session.game.externalGameId)
    }
    await this.play.touchSession(session.id)
    return session
  }

  buildDisplayName(userId: string): string {
    return `Player ${userId.slice(0, 8)}`
  }

  isDemoToken(sessionToken: string): boolean {
    return sessionToken.startsWith(DEMO_TOKEN_PREFIX)
  }
}
