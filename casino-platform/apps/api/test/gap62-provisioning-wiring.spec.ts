/**
 * DI-спек GAP-62: провижининг служебной учётки партнёра собран в графе.
 *
 * Класс дефекта, против которого эта спека: «use case написан, но не подключён
 * к модулю». `tsc` и юнит-тесты его не ловят — код компилируется, а падает
 * только при поднятии контейнера Nest (в репо такое случалось дважды, см.
 * `test/admin-module-wiring.spec.ts`). Для GAP-62 цена особенно высока:
 * `UsersFacade` инжектится в affiliate use case'ы по классу, и незакрытая
 * зависимость означала бы 500 на `POST /affiliate/register`.
 *
 * Проверяет три вещи:
 *  1) оба новых use-case users стоят в providers UsersModule, фасад — в exports,
 *     а порт USER_PROFILE_REPOSITORY закрыт Prisma-реализацией с новыми
 *     методами;
 *  2) AffiliateModule импортирует UsersModule;
 *  3) из инфраструктуры affiliate исчезли write-методы чужой таблицы — порт
 *     AFFILIATE_PLAYER_PROVISIONING_REPOSITORY остался только для чтений.
 */
import { describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

// Реальные экспорт-ы пакета (LedgerEntryType и прочие enum-ы) нужны цепочке
// импортов AffiliateModule, поэтому подменяем только клиент prisma — образец
// `test/admin-module-wiring.spec.ts`. В этом файле БД не вызывается: тесты
// читают DI-метаданные и прототипы классов.
vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return { ...actual, prisma: {} }
})

import { AffiliateModule } from '../src/modules/affiliate/affiliate.module'
import { CreateAffiliateByAdminUseCase } from '../src/modules/affiliate/application/use-cases/create-affiliate-by-admin.use-case'
import { RegisterAffiliateUseCase } from '../src/modules/affiliate/application/use-cases/register-affiliate.use-case'
import { PrismaPlayerProvisioningRepository } from '../src/modules/affiliate/infrastructure/player-provisioning.prisma.repository'
import { DeprovisionAffiliatePlayerUseCase } from '../src/modules/users/application/use-cases/deprovision-affiliate-player.use-case'
import { ProvisionAffiliatePlayerUseCase } from '../src/modules/users/application/use-cases/provision-affiliate-player.use-case'
import { USER_PROFILE_REPOSITORY } from '../src/modules/users/domain/repositories/user-profile.repository'
import { UsersFacade } from '../src/modules/users/facade/users.facade'
import { PrismaUserProfileRepository } from '../src/modules/users/infrastructure/repositories/user-profile.prisma'
import { UsersModule } from '../src/modules/users/users.module'

// Свойства обязательны и могут быть undefined: при exactOptionalPropertyTypes
// присвоить `unknown[] | undefined` опциональному `providers?: unknown[]` нельзя.
type ModuleMetadata = {
  providers: unknown[] | undefined
  exports: unknown[] | undefined
  imports: unknown[] | undefined
}

/** Провайдер в Nest-метаданных — либо сам класс, либо { provide, useClass }. */
function metadataOf(target: object): ModuleMetadata {
  return {
    providers: Reflect.getMetadata('providers', target) as unknown[] | undefined,
    exports: Reflect.getMetadata('exports', target) as unknown[] | undefined,
    imports: Reflect.getMetadata('imports', target) as unknown[] | undefined,
  }
}

function useClassFor(providers: unknown[], token: unknown): unknown {
  const entry = providers.find(
    (provider) =>
      typeof provider === 'object' &&
      provider !== null &&
      (provider as { provide?: unknown }).provide === token,
  ) as { useClass?: unknown } | undefined
  return entry?.useClass
}

describe('GAP-62: DI-сборка провижининга партнёрской учётной записи', () => {
  const usersMetadata = metadataOf(UsersModule)
  const affiliateMetadata = metadataOf(AffiliateModule)

  it('модуль users предоставляет оба новых use-case', () => {
    expect(usersMetadata.providers ?? []).toContain(ProvisionAffiliatePlayerUseCase)
    expect(usersMetadata.providers ?? []).toContain(DeprovisionAffiliatePlayerUseCase)
  })

  it('UsersFacade наружу, а его новые зависимости закрыты провайдерами', () => {
    expect(usersMetadata.exports ?? []).toContain(UsersFacade)
    const provisioningProviders = (usersMetadata.providers ?? []).filter(
      (provider) =>
        provider === ProvisionAffiliatePlayerUseCase ||
        provider === DeprovisionAffiliatePlayerUseCase,
    )
    expect(provisioningProviders).toHaveLength(2)
  })

  it('порт пользователя ведёт на Prisma-репозиторий с созданием и удалением', () => {
    expect(useClassFor(usersMetadata.providers ?? [], USER_PROFILE_REPOSITORY)).toBe(
      PrismaUserProfileRepository,
    )
    const repository = new PrismaUserProfileRepository()
    expect(typeof repository.createServiceUser).toBe('function')
    expect(typeof repository.deleteServiceUser).toBe('function')
  })

  it('affiliate импортирует users — иначе UsersFacade нерезолвим', () => {
    expect(affiliateMetadata.imports ?? []).toContain(UsersModule)
  })

  it('из инфраструктуры affiliate убраны write-методы чужой таблицы', () => {
    const prototype = PrismaPlayerProvisioningRepository.prototype as unknown as Record<
      string,
      unknown
    >
    expect(prototype).not.toHaveProperty('createPlayerUser')
    expect(prototype).not.toHaveProperty('deletePlayerUser')
    // Чтения остались намеренно: их легализует ADR GAP-51.
    expect(typeof prototype['isPlayerReferralCodeAvailable']).toBe('function')
    expect(typeof prototype['isKycApproved']).toBe('function')
  })

  it('affiliate-сценарии инжектят UsersFacade последним параметром (G22)', () => {
    // Гвард G22 проверяет наличие @Inject статически; здесь — что размер
    // конструктора действительно вырос под фасад: без этого Nest не передаёт
    // зависимость, и провижининг падает на старте приложения.
    expect(RegisterAffiliateUseCase.length).toBe(5)
    expect(CreateAffiliateByAdminUseCase.length).toBe(4)
    expect(UsersFacade).toBeDefined()
  })
})
