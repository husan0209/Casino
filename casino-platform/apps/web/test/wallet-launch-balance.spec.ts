import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWalletStore } from '@/stores/wallet'

/**
 * `getLaunchBalance` — ответ на вопрос «есть чем играть» для развилки
 * `realMoneyStep` (§8.2). Три состояния, а не два: «не знаем» (балансы ещё не
 * пришли), «пусто» (пришли, а активного кошелька нет — у нового игрока бэк
 * отдаёт `[]`) и «есть сумма». Без второго случая тап «Играть на деньги» у
 * свежего аккаунта уходил на страницу игры и возвращался кассой через серверный
 * `INSUFFICIENT_FUNDS`.
 */

vi.mock('@/lib/api/wallet.api', () => ({
  fetchBalances: vi.fn(),
  setActiveCurrency: vi.fn(),
}))

beforeEach(() => {
  useWalletStore.setState({
    wallets: [],
    activeCurrency: 'RUB',
    loaded: false,
    isLoading: false,
  })
})

describe('getLaunchBalance', () => {
  it('балансы не приходили — null, решает сервер', () => {
    expect(useWalletStore.getState().getLaunchBalance()).toBeNull()
  })

  it('пришли, но активного кошелька нет — «0»', () => {
    useWalletStore.setState({ wallets: [], loaded: true, activeCurrency: 'RUB' })

    expect(useWalletStore.getState().getLaunchBalance()).toBe('0')
  })

  it('активный кошелёк есть — его available, в том числе нулевой', () => {
    useWalletStore.setState({
      wallets: [
        { currency: 'RUB', balance: '0', locked: '0', available: '0' },
        { currency: 'USDT_TRC20', balance: '50', locked: '0', available: '50' },
      ],
      loaded: true,
      activeCurrency: 'USDT_TRC20',
    })

    expect(useWalletStore.getState().getLaunchBalance()).toBe('50')
  })

  it('валюта выбрана, а кошелька с ней нет — «0», а не чужой баланс', () => {
    useWalletStore.setState({
      wallets: [{ currency: 'USDT_TRC20', balance: '50', locked: '0', available: '50' }],
      loaded: true,
      activeCurrency: 'RUB',
    })

    expect(useWalletStore.getState().getLaunchBalance()).toBe('0')
  })
})
