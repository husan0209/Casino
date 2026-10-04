/**
 * BlockPlayerUseCase (G24): блокировка игрока принадлежит модулю users.
 *
 * Проверяется ровно то, из-за чего операция переехала: use case отдаёт команду
 * порту ОДНИМ вызовом и не пытается «доделать» отзыв сессий вторым вызовом.
 * Атомарность пары «статус + сессии» держит реализация порта
 * (`users-player-block-status.spec.ts`), и раздельные вызовы здесь означали бы
 * гонку между двумя таблицами.
 */
import { describe, expect, it, vi } from 'vitest'

import { BlockPlayerUseCase } from './block-player.use-case'

import type { IUserStatusRepository } from '../../domain/repositories/user-status.repository'

function makeUseCase(block: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined)): {
  uc: BlockPlayerUseCase
  block: ReturnType<typeof vi.fn>
} {
  const repo: Partial<IUserStatusRepository> = { block }
  return { uc: new BlockPlayerUseCase(repo as IUserStatusRepository), block }
}
describe('BlockPlayerUseCase', () => {
  it('зовёт block() один раз на id игрока', async () => {
    const { uc, block } = makeUseCase()

    await uc.execute('u-9')

    expect(block.mock.calls).toEqual([['u-9']])
  })

  it('ничего не возвращает: у блокировки нет полезного payload для админа', async () => {
    const { uc } = makeUseCase()
    await expect(uc.execute('u-9')).resolves.toBeUndefined()
  })

  it('ошибку порта не проглатывает — admin должен получить падение, а не ложный успех', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('user not found'))
    const { uc } = makeUseCase(failing)

    await expect(uc.execute('u-missing')).rejects.toThrow('user not found')
  })
})
