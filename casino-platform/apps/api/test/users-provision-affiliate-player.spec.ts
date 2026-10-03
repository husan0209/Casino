/**
 * G21-спек ProvisionAffiliatePlayerUseCase (GAP-62, модуль users).
 *
 * Партнёрская программа раньше сама делала INSERT в `users` (чужую таблицу).
 * Запись вернулась владельцу данных, и решение «какая это учётная запись»
 * теперь принимается здесь: email=null, status='active', referral_code —
 * переданный (уникальный). Спека держит именно эту семантику 1-в-1 со старым
 * `affiliate/infrastructure/player-provisioning.prisma.repository.ts`, иначе
 * эндпоинты `POST /affiliate/register` и `POST /admin/affiliates` записывали бы
 * другую строку.
 *
 * Сэмпл фейка порта — `test/users-update-currency-preference.spec.ts`.
 */
import { ProvisionAffiliatePlayerUseCase } from '../src/modules/users/application/use-cases/provision-affiliate-player.use-case'
import { USER_PROFILE_REPOSITORY } from '../src/modules/users/domain/repositories/user-profile.repository'

import type {
  CreateServiceUserInput,
  IUserProfileRepository,
} from '../src/modules/users/domain/repositories/user-profile.repository'

interface FakeProfileRepo extends Partial<IUserProfileRepository> {
  createServiceUser: (input: CreateServiceUserInput) => Promise<{ id: string }>
}

function makeRepo(
  create: (input: CreateServiceUserInput) => Promise<{ id: string }>,
): FakeProfileRepo {
  return { createServiceUser: create }
}

/** Собирает use case вручную: конструктор требует @Inject(PORT) — порт по токену. */
function makeUseCase(repo: Partial<IUserProfileRepository>): ProvisionAffiliatePlayerUseCase {
  return new ProvisionAffiliatePlayerUseCase(repo as IUserProfileRepository)
}

const REFERRAL_CODE = 'affK7M2QX9P'

describe('ProvisionAffiliatePlayerUseCase', () => {
  it('служебная учётка партнёра: email null, status active, переданный referral_code', async () => {
    const received: CreateServiceUserInput[] = []
    const repo = makeRepo(async (input) => {
      received.push(input)
      return { id: 'user-1' }
    })

    const result = await makeUseCase(repo).execute({ referralCode: REFERRAL_CODE })

    expect(received).toEqual([{ email: null, status: 'active', referralCode: REFERRAL_CODE }])
    expect(result).toEqual({ id: 'user-1' })
  })

  it('id новой строки уходит наружу — он же идёт в affiliates.user_id', async () => {
    const repo = makeRepo(async () => ({ id: 'partner-player-77' }))

    const result = await makeUseCase(repo).execute({ referralCode: REFERRAL_CODE })

    expect(result.id).toBe('partner-player-77')
  })

  it('конфликт уникальности referral_code: ошибка БД пробрасывается как есть', async () => {
    // Prisma на @unique бросает PrismaClientKnownRequestError с code P2002.
    // Use case не подменяет её своим AppError: HTTP-контракт (500 и форма
    // errorResponse) до переноса был именно таким, и менять его нельзя.
    const conflict = Object.assign(
      new Error('Unique constraint failed on the fields: (`referral_code`)'),
      { code: 'P2002', name: 'PrismaClientKnownRequestError' },
    )
    const repo = makeRepo(async () => {
      throw conflict
    })

    await expect(makeUseCase(repo).execute({ referralCode: REFERRAL_CODE })).rejects.toBe(conflict)
  })

  it('отказ репозитория (БД недоступна) — ошибка пробрасывается, id не выдуман', async () => {
    const repo = makeRepo(async () => {
      throw new Error('db down')
    })

    await expect(makeUseCase(repo).execute({ referralCode: REFERRAL_CODE })).rejects.toThrow(
      'db down',
    )
  })

  it('учётка создаётся ровно один раз: ретраев нет, иначе плодились бы сироты', async () => {
    let calls = 0
    const repo = makeRepo(async () => {
      calls += 1
      return { id: `user-${calls}` }
    })

    await makeUseCase(repo).execute({ referralCode: REFERRAL_CODE })

    expect(calls).toBe(1)
  })

  it('порт отдаётся по токену USER_PROFILE_REPOSITORY — без прямого доступа к Prisma', () => {
    // G22: параметр конструктора помечен @Inject(USER_PROFILE_REPOSITORY), и
    // токен объявлен в домене. Проверяем, что use case принимает ровно один
    // аргумент-порт: второй (например, Prisma-клиент) вернул бы нарушение
    // §3.2 обратно в application-слой.
    expect(ProvisionAffiliatePlayerUseCase.length).toBe(1)
    expect(typeof USER_PROFILE_REPOSITORY).toBe('symbol')
  })
})
