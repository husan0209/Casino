/**
 * UnblockPlayerUseCase (G24): снятие блокировки.
 *
 * Отдельный файл, а не параметр `block(bool)`, потому что у операций разное
 * следствие: блокировка отзывает сессии, разблокировка — нет. Один метод на
 * два случая рано или поздно соблазнил бы «восстановить отозванное», и это
 * дыра (refresh-токен пережил бы блокировку).
 */
import { describe, expect, it, vi } from 'vitest'

import { UnblockPlayerUseCase } from './unblock-player.use-case'

import type { IUserStatusRepository } from '../../domain/repositories/user-status.repository'

describe('UnblockPlayerUseCase', () => {
  it('зовёт unblock() один раз и только его', async () => {
    const block = vi.fn()
    const unblock = vi.fn().mockResolvedValue(undefined)
    const uc = new UnblockPlayerUseCase({ block, unblock } as unknown as IUserStatusRepository)

    await uc.execute('u-9')

    expect(unblock.mock.calls).toEqual([['u-9']])
    expect(block).not.toHaveBeenCalled()
  })

  it('не пытается трогать сессии: у порта нет метода «вернуть отозванные»', () => {
    const iface: IUserStatusRepository = {
      block: async () => undefined,
      unblock: async () => undefined,
    }
    expect(Object.keys(iface).sort()).toEqual(['block', 'unblock'])
  })
})
