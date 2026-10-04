import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { BlockPlayerUseCase } from './application/use-cases/block-player.use-case'
import { DeprovisionAffiliatePlayerUseCase } from './application/use-cases/deprovision-affiliate-player.use-case'
import { GetGeoContextUseCase } from './application/use-cases/get-geo-context.use-case'
import { GetMeUseCase } from './application/use-cases/get-me.use-case'
import { ListSessionsUseCase } from './application/use-cases/list-sessions.use-case'
import { ProvisionAffiliatePlayerUseCase } from './application/use-cases/provision-affiliate-player.use-case'
import { RevokeAllSessionsUseCase } from './application/use-cases/revoke-all-sessions.use-case'
import { RevokeSessionUseCase } from './application/use-cases/revoke-session.use-case'
import { SelfExclusionUseCase } from './application/use-cases/self-exclusion.use-case'
import { SetAvatarUseCase } from './application/use-cases/set-avatar.use-case'
import { UnblockPlayerUseCase } from './application/use-cases/unblock-player.use-case'
import { UpdateAfterDepositUseCase } from './application/use-cases/update-after-deposit.use-case'
import { UpdateCurrencyPreferenceUseCase } from './application/use-cases/update-currency-preference.use-case'
import { UpdateProfileUseCase } from './application/use-cases/update-profile.use-case'
import { UpdateSettingsUseCase } from './application/use-cases/update-settings.use-case'
import { USER_PROFILE_REPOSITORY } from './domain/repositories/user-profile.repository'
import { USER_SESSION_REPOSITORY } from './domain/repositories/user-session.repository'
import { USER_SETTINGS_REPOSITORY } from './domain/repositories/user-settings.repository'
import { USER_STATUS_REPOSITORY } from './domain/repositories/user-status.repository'
import { UsersFacade } from './facade/users.facade'
import { PrismaUserProfileRepository } from './infrastructure/repositories/user-profile.prisma'
import { PrismaUserSessionRepository } from './infrastructure/repositories/user-session.prisma'
import { PrismaUserSettingsRepository } from './infrastructure/repositories/user-settings.prisma'
import { PrismaUserStatusRepository } from './infrastructure/repositories/user-status.prisma'
import { UsersController } from './presentation/controllers/users.controller'

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    GetMeUseCase,
    UpdateProfileUseCase,
    UpdateSettingsUseCase,
    ListSessionsUseCase,
    RevokeSessionUseCase,
    RevokeAllSessionsUseCase,
    SelfExclusionUseCase,
    SetAvatarUseCase,
    UpdateCurrencyPreferenceUseCase,
    GetGeoContextUseCase,
    UpdateAfterDepositUseCase,
    // GAP-62: провижининг/депровижининг служебной учётки партнёра — наружу
    // только через UsersFacade, сами use case'ы остаются внутри модуля.
    ProvisionAffiliatePlayerUseCase,
    DeprovisionAffiliatePlayerUseCase,
    // G24: блокировка/разблокировка игрока. Статус `users` и отзыв `sessions`
    // пишет владелец этих таблиц, а не заказчик (раньше это делал admin).
    BlockPlayerUseCase,
    UnblockPlayerUseCase,
    UsersFacade,
    { provide: USER_PROFILE_REPOSITORY, useClass: PrismaUserProfileRepository },
    { provide: USER_SESSION_REPOSITORY, useClass: PrismaUserSessionRepository },
    { provide: USER_SETTINGS_REPOSITORY, useClass: PrismaUserSettingsRepository },
    { provide: USER_STATUS_REPOSITORY, useClass: PrismaUserStatusRepository },
  ],
  exports: [UsersFacade, SelfExclusionUseCase],
})
export class UsersModule {}
