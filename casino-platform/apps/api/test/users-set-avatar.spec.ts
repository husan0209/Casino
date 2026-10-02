/**
 * Юнит-тесты SetAvatarUseCase (G21, В3).
 *
 * Контракт: буфер кладётся в ./uploads/avatars под именем, которое генерируем
 * сами (uuid + расширение от sniffed-типа), а avatar_url уходит в БД ТОЛЬКО
 * через порт IUserProfileRepository — presentation больше не строит
 * PrismaUserProfileRepository конструктором.
 */
import { mkdirSync, writeFileSync } from 'fs'

import { SetAvatarUseCase } from '../src/modules/users/application/use-cases/set-avatar.use-case'

import type { IUserProfileRepository } from '../src/modules/users/domain/repositories/user-profile.repository'

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

// Сниффер подменяем: проверка magic bytes — ответственность контроллера,
// здесь важна только связь «MIME → расширение».
vi.mock('@/common/files/file-sniffer', () => ({
  extForMime: (mime: string) => `.${mime.split('/')[1]}`,
}))

type SavedAvatar = { userId: string; avatarUrl: string }

function makeProfileRepo(setAvatarImpl?: (userId: string, avatarUrl: string) => Promise<void>): {
  repo: IUserProfileRepository
  saved: SavedAvatar[]
} {
  const saved: SavedAvatar[] = []
  const repo = {
    setAvatar:
      setAvatarImpl ??
      (async (userId: string, avatarUrl: string): Promise<void> => {
        saved.push({ userId, avatarUrl })
      }),
  }
  return { repo: repo as unknown as IUserProfileRepository, saved }
}

function makeUseCase(setAvatarImpl?: (userId: string, avatarUrl: string) => Promise<void>) {
  const { repo, saved } = makeProfileRepo(setAvatarImpl)
  return { uc: new SetAvatarUseCase(repo), saved }
}

describe('SetAvatarUseCase', () => {
  beforeEach(() => {
    vi.mocked(mkdirSync).mockClear()
    vi.mocked(writeFileSync).mockClear()
  })

  it('happy path: каталог создан, файл под mode 0o600, avatar_url записан через порт', async () => {
    const { uc, saved } = makeUseCase()
    const buffer = Buffer.from('png-bytes')

    const res = await uc.execute({ userId: 'user-1', buffer, mimeType: 'image/png' })

    expect(res.avatar_url).toMatch(/^\/uploads\/avatars\/[0-9a-f-]{36}\.png$/)
    expect(mkdirSync).toHaveBeenCalledWith('./uploads/avatars', { recursive: true })
    // путь на диске = префикс «.» к публичному url (отдаём /uploads/…, пишем ./uploads/…)
    expect(writeFileSync).toHaveBeenCalledWith(`.${res.avatar_url}`, buffer, { mode: 0o600 })
    expect(saved).toEqual([{ userId: 'user-1', avatarUrl: res.avatar_url }])
  })

  it('расширение — из sniffed MIME, а не из имени клиента (P1 #12)', async () => {
    const { uc } = makeUseCase()

    const res = await uc.execute({
      userId: 'user-1',
      buffer: Buffer.from('x'),
      mimeType: 'image/webp',
    })

    expect(res.avatar_url).toMatch(/\.[0-9a-z]+$/)
    expect(res.avatar_url.endsWith('.webp')).toBe(true)
  })

  it('повторная загрузка не перезатирает файл предыдущего пользователя: имена уникальны', async () => {
    const { uc, saved } = makeUseCase()

    const first = await uc.execute({
      userId: 'user-1',
      buffer: Buffer.from('a'),
      mimeType: 'image/jpeg',
    })
    const second = await uc.execute({
      userId: 'user-2',
      buffer: Buffer.from('b'),
      mimeType: 'image/jpeg',
    })

    expect(first.avatar_url).not.toBe(second.avatar_url)
    expect(saved.map((row) => row.userId)).toEqual(['user-1', 'user-2'])
    expect(saved.map((row) => row.avatarUrl)).toEqual([first.avatar_url, second.avatar_url])
  })

  it('отказ порта (setAvatar бросил) — ошибка пробрасывается, url не возвращается', async () => {
    const { uc } = makeUseCase(async () => {
      throw new Error('db down')
    })

    await expect(
      uc.execute({ userId: 'user-1', buffer: Buffer.from('a'), mimeType: 'image/png' }),
    ).rejects.toThrow('db down')
  })
})
