import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type Currency } from '@casino/shared-types'

import { OriginalsSessionLoader } from './originals-session-loader'

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

const TIGER_DEFAULT_BET_SIZES = ['0.2', '2', '20', '100']

const TIGER_IDLE_ICONS = [
  'Symbol_2',
  'Symbol_1',
  'Symbol_3',
  'Symbol_4',
  'Symbol_6',
  'Symbol_5',
  'Symbol_4',
  'Symbol_4',
  'Symbol_4',
]

const TIGER_IDLE_LINES = [
  {
    name: 'Symbol_4',
    index: 3,
    payout: 10,
    combine: 3,
    way_243: 1,
    multiply: 0,
    win_amount: 2,
    active_icon: [7, 8, 9],
  },
]

@Injectable()
export class OriginalsSessionUseCase {
  constructor(
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
    @Inject(WalletFacade) private readonly wallet: WalletFacade,
  ) {}

  async execute(sessionToken: string): Promise<TigerSessionData> {
    if (this.sessionLoader.isDemoToken(sessionToken)) {
      return this.buildSessionData({
        displayName: 'Guest',
        credit: TIGER_DEMO_START_CREDIT,
        currencyLabel: 'RUB',
      })
    }
    const { session } = await this.sessionLoader.loadActiveSlotSession(sessionToken)
    const balance = await this.wallet.getBalance(session.userId, session.currency as Currency)
    return this.buildSessionData({
      displayName: this.sessionLoader.buildDisplayName(session.userId),
      credit: balance.available,
      currencyLabel: session.currency,
    })
  }

  private buildSessionData(args: {
    displayName: string
    credit: string
    currencyLabel: string
  }): TigerSessionData {
    return {
      user_name: args.displayName,
      credit: new Decimal(args.credit).toDecimalPlaces(2).toNumber(),
      num_line: 5,
      line_num: 5,
      bet_amount: 0.2,
      free_num: 0,
      free_total: -1,
      free_amount: 4,
      free_multi: 0,
      freespin_mode: 0,
      multiple_list: [],
      credit_line: 1,
      buy_feature: 50,
      buy_max: 1300,
      feature: [],
      total_way: 27,
      multiply: 0,
      icon_data: [...TIGER_IDLE_ICONS],
      active_lines: [...TIGER_IDLE_LINES],
      drop_line: [],
      currency_prefix: args.currencyLabel,
      currency_suffix: '',
      currency_thousand: '.',
      currency_decimal: ',',
      bet_size_list: [...TIGER_DEFAULT_BET_SIZES],
      previous_session: false,
      game_state: '',
      feature_result: [],
    }
  }
}
