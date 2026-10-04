import * as argon2 from 'argon2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminUsersService } from '../src/modules/admin/application/admin-users.service'

import type { IAdminUserRepository } from '../src/modules/admin/domain/admin.repository'

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(async () => 'argon2id:admin-hash'),
  verify: vi.fn(async () => true),
}))

/**
 * Создание и блокировка администраторов.
 *
 * Проверяются три вещи, которые не видны из типов:
 *  1) пароль в репозиторий НЕ попадает — только хеш, и хеш по тем же
 *     параметрам, что и у игроков (argon2id / 64 MiB / 3 / 4): админский
 *     аккаунт — самая желанная цель перебора, тихое ослабление здесь дороже;
 *  2) поля `createdBy` и имена передаются только когда заданы — при
 *     `exactOptionalPropertyTypes` случайный `undefined` в объекте запроса
 *     означает «затираем колонку», а не «не трогаем»;
 *  3) block/unblock и block/unblock игрока — это РАЗНЫЕ операции: первые
 *     работают по таблице администраторов (`setActive`), вторые по игрокам и
 *     обязаны отзывать сессии (реализация — порт, см. В3).
 */
function makeRepo() {
  const repo = {
    list: vi.fn().mockResolvedValue({ items: [{ id: 'adm-1' }], total: 1 }),
    create: vi
      .fn()
      .mockImplementation((input: Record<string, unknown>) =>
        Promise.resolve({ id: 'adm-new', ...input }),
      ),
    setActive: vi
      .fn()
      .mockImplementation((id: string, isActive: boolean) => Promise.resolve({ id, isActive })),
    blockPlayer: vi.fn().mockResolvedValue(undefined),
    unblockPlayer: vi.fn().mockResolvedValue(undefined),
    touchLastLogin: vi.fn().mockResolvedValue(undefined),
  }
  return { service: new AdminUsersService(repo as unknown as IAdminUserRepository), repo }
}

describe('AdminUsersService.create', () => {
  beforeEach(() => {
    vi.mocked(argon2.hash).mockClear()
  })

  it('хешит пароль по платформенным параметрам и передаёт в порт только хеш', async () => {
    const { service, repo } = makeRepo()

    await service.create({ email: 'root@example.com', password: 'sup3r-s3cret', role: 'admin' })

    expect(argon2.hash).toHaveBeenCalledWith('sup3r-s3cret', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    })
    const input = repo.create.mock.calls[0]?.[0] as Record<string, unknown>
    expect(input.passwordHash).toBe('argon2id:admin-hash')
    expect(JSON.stringify(input)).not.toContain('sup3r-s3cret')
  })

  it('без created_by и имён — ключей в объекте нет вовсе (не undefined-значение)', async () => {
    const { service, repo } = makeRepo()

    await service.create({ email: 'a@example.com', password: 'p', role: 'admin' })

    expect(Object.keys(repo.create.mock.calls[0]?.[0] as object).sort()).toEqual([
      'email',
      'passwordHash',
      'role',
    ])
  })

  it('createdBy, first_name и last_name пробрасываются, когда заданы', async () => {
    const { service, repo } = makeRepo()

    await service.create(
      {
        email: 'a@example.com',
        password: 'p',
        role: 'superadmin',
        first_name: 'Иван',
        last_name: 'Петров',
      },
      'adm-1',
    )

    expect(repo.create.mock.calls[0]?.[0]).toMatchObject({
      firstName: 'Иван',
      lastName: 'Петров',
      createdBy: 'adm-1',
      role: 'superadmin',
    })
  })
})

describe('AdminUsersService — блокировки', () => {
  it('block и unblock работают по таблице админов (setActive false/true)', async () => {
    const { service, repo } = makeRepo()

    await service.block('adm-3')
    await service.unblock('adm-3')

    expect(repo.setActive.mock.calls).toEqual([
      ['adm-3', false],
      ['adm-3', true],
    ])
    expect(repo.blockPlayer).not.toHaveBeenCalled()
  })

  it('блокировка игрока идёт своим путём и не трогает админскую таблицу', async () => {
    const { service, repo } = makeRepo()

    await service.blockPlayer('u-9')
    await service.unblockPlayer('u-9')

    expect(repo.blockPlayer.mock.calls).toEqual([['u-9']])
    expect(repo.unblockPlayer.mock.calls).toEqual([['u-9']])
    expect(repo.setActive).not.toHaveBeenCalled()
  })

  it('list по умолчанию — страница 1 по 20', async () => {
    const { service, repo } = makeRepo()

    await service.list()

    expect(repo.list).toHaveBeenCalledWith(1, 20)
  })

  it('touchLastLogin — тонкий проброс, без своей логики', async () => {
    const { service, repo } = makeRepo()

    await service.touchLastLogin('adm-2')

    expect(repo.touchLastLogin).toHaveBeenCalledWith('adm-2')
  })
})
