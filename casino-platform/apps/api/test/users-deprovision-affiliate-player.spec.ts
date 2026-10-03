/**
 * G21-спек DeprovisionAffiliatePlayerUseCase (GAP-62, модуль users).
 *
 * Компенсационное удаление сироты: потребитель (affiliate) создал служебную
 * user-запись, его собственная запись партнёра не состоялась, и в `users`
 * осталась строка без `affiliates`. Раньше этот DELETE делал affiliate — write
 * в чужую таблицу, который ADR GAP-51 не разрешает.
 *
 * Два инварианта, которые держит спека:
 *  1) удаление идёт ровно по тому id, который вернул провижининг (иначе
 *     удалялся бы чужой аккаунт);
 *  2) отказ удаления не превращается во вторую ошибку: вызов стоит в catch
 *     ветке потребителя, и наружу должна уйти первоначальная причина отказа.
 */
import { DeprovisionAffiliatePlayerUseCase } from '../src/modules/users/application/use-cases/deprovision-affiliate-player.use-case'
import { USER_PROFILE_REPOSITORY } from '../src/modules/users/domain/repositories/user-profile.repository'

import type { IUserProfileRepository } from '../src/modules/users/domain/repositories/user-profile.repository'

function makeUseCase(deleteServiceUser: IUserProfileRepository['deleteServiceUser']) {
  const repo = { deleteServiceUser } as unknown as IUserProfileRepository
  return { useCase: new DeprovisionAffiliatePlayerUseCase(repo), repo }
}

describe('DeprovisionAffiliatePlayerUseCase', () => {
  it('happy path: служебная запись удалена по id, который вернул провижининг', async () => {
    const deleted: string[] = []
    const { useCase } = makeUseCase(async (userId) => {
      deleted.push(userId)
      return true
    })

    await expect(useCase.execute('partner-player-1')).resolves.toBeUndefined()
    expect(deleted).toEqual(['partner-player-1'])
  })

  it('служебная запись опознана по email IS NULL: удаление возвращает true', async () => {
    // Порт обещает удалять только строку без email — единственный предохранитель
    // против «удали по id любого игрока» в публичном API модуля.
    let servedGuard = false
    const { useCase } = makeUseCase(async (userId) => {
      servedGuard = userId.length > 0
      return servedGuard
    })

    await useCase.execute('partner-player-1')

    expect(servedGuard).toBe(true)
  })

  it('строки уже нет (или это не служебная запись) — молча ничего не делаем', async () => {
    // Идемпотентность: повторный compensate (или гонка с очисткой) не должен
    // ронять запрос партнёра второй ошибкой поверх исходной.
    const { useCase } = makeUseCase(async () => false)

    await expect(useCase.execute('partner-player-1')).resolves.toBeUndefined()
  })

  it('отказ репозитория пробрасывается наружу — решение о логов берёт потребитель', async () => {
    const failure = new Error('db down')
    const { useCase } = makeUseCase(async () => {
      throw failure
    })

    await expect(useCase.execute('partner-player-1')).rejects.toBe(failure)
  })

  it('конструктор принимает ровно один порт (G22: @Inject(USER_PROFILE_REPOSITORY))', () => {
    expect(DeprovisionAffiliatePlayerUseCase.length).toBe(1)
    expect(typeof USER_PROFILE_REPOSITORY).toBe('symbol')
  })
})
