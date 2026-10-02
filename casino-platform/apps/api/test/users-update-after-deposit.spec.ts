/**
 * Юнит-тесты UpdateAfterDepositUseCase (G21).
 *
 * Хук после успешного депозита: запоминает валюту и метод оплаты для
 * geo-дефолтов следующего депозита. Чистый прокси, void-результат.
 */
import { UpdateAfterDepositUseCase } from '../src/modules/users/application/use-cases/update-after-deposit.use-case'

import type { IUserProfileRepository } from '../src/modules/users/domain/repositories/user-profile.repository'

describe('UpdateAfterDepositUseCase', () => {
  it('валюта и метод проксируются в репозиторий', async () => {
    const got: Array<{ userId: string; currency: string; method: string }> = []
    const repo = {
      updateAfterDeposit: async (userId: string, currency: string, method: string) => {
        got.push({ userId, currency, method })
      },
    } as unknown as IUserProfileRepository

    await expect(
      new UpdateAfterDepositUseCase(repo).execute('u-1', 'USDT_TRC20', 'usdt_trc20'),
    ).resolves.toBeUndefined()

    expect(got).toEqual([{ userId: 'u-1', currency: 'USDT_TRC20', method: 'usdt_trc20' }])
  })

  it('отказ порта (updateAfterDeposit бросил) — ошибка пробрасывается', async () => {
    const repo = {
      updateAfterDeposit: async () => {
        throw new Error('db down')
      },
    } as unknown as IUserProfileRepository
    await expect(
      new UpdateAfterDepositUseCase(repo).execute('u-1', 'RUB', 'card'),
    ).rejects.toThrow('db down')
  })
})
