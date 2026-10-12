import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type Currency } from '@casino/shared-types'

import { OriginalsSessionLoader } from './originals-session-loader'
import { type HouseSlotGameConfig } from '../../domain/house-slot-game'

/**
 * Session house-слота для фронта Construct 3.
 *
 * Форма ответа — 1-в-1 SessionStructure донора ViperPro-Casino
 * (PrivateGamesTrait): фронт читает фиксированные поля (user_name, credit,
 * num_line, bet_amount, icon_data, active_lines, bet_size_list...).
 * Стартовый стол одинаков у всех слотов донора (проверено на контроллерах
 * tiger/ox: стабы совпадают). Деньги в ответе — числа с 2 знаками
 * (требование фиксированного внешнего клиента, как сырые shapes
 * provider-callback): внутри все расчёты только строками через money.*.
 */
export interface TigerSessionData {
  user_name: string
  credit: number
  num_line: number
  line_num: number
  bet_amount: number
  free_num: number
  free_total: number
  free_amount: number
  free_multi: number
  freespin_mode: number
  multiple_list: unknown[]
  credit_line: number
  buy_feature: number
  buy_max: number
  feature: unknown[]
  total_way: number
  multiply: number
  icon_data: string[]
  active_lines: unknown[]
  drop_line: unknown[]
  currency_prefix: string
  currency_suffix: string
  currency_thousand: string
  currency_decimal: string
  bet_size_list: string[]
  previous_session: boolean
  game_state: string
  feature_result: unknown[]
}

/** Стартовый лицевой баланс демо-режима пилота (донор хранит balance_demo в БД). */
export const TIGER_DEMO_START_CREDIT = '1000.00'

@Injectable()
export class OriginalsSessionUseCase {
  constructor(
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
    @Inject(WalletFacade) private readonly wallet: WalletFacade,
  ) {}

  async execute(sessionToken: string): Promise<TigerSessionData> {
    if (this.sessionLoader.isDemoToken(sessionToken)) {
      const game = this.sessionLoader.loadDemoSlotGame(sessionToken)
      return this.buildSessionData(game, {
        displayName: 'Guest',
        credit: TIGER_DEMO_START_CREDIT,
        currencyLabel: 'RUB',
      })
    }
    const { session, game } = await this.sessionLoader.loadActiveSlotSession(sessionToken)
    const balance = await this.wallet.getBalance(session.userId, session.currency as Currency)
    return this.buildSessionData(game, {
      displayName: this.sessionLoader.buildDisplayName(session.userId),
      credit: balance.available,
      currencyLabel: session.currency,
    })
  }

  /**
   * Idle-блок берётся из таблиц конкретной игры: у «пятилинейной» ветки донора
   * он один на всех (9 ячеек, 27 ways), у 3x5 игр — свой (15 ячеек, 243 ways,
   * несколько подсвеченных линий).
   */
  private buildSessionData(
    game: HouseSlotGameConfig,
    args: { displayName: string; credit: string; currencyLabel: string },
  ): TigerSessionData {
    const defaults = game.session
    return {
      user_name: args.displayName,
      credit: new Decimal(args.credit).toDecimalPlaces(2).toNumber(),
      num_line: defaults.numLine,
      line_num: defaults.numLine,
      bet_amount: Number(defaults.betSizeList[0]),
      free_num: 0,
      free_total: -1,
      free_amount: defaults.freeAmount,
      free_multi: 0,
      freespin_mode: 0,
      multiple_list: [],
      credit_line: defaults.creditLine,
      buy_feature: defaults.buyFeature,
      buy_max: defaults.buyMax,
      feature: [],
      total_way: defaults.totalWay,
      multiply: 0,
      icon_data: [...defaults.iconData],
      active_lines: defaults.activeLines.map((line) => ({ ...line })),
      drop_line: [...defaults.dropLine],
      currency_prefix: args.currencyLabel,
      currency_suffix: '',
      currency_thousand: '.',
      currency_decimal: ',',
      bet_size_list: [...defaults.betSizeList],
      previous_session: false,
      game_state: '',
      feature_result: [],
    }
  }
}
