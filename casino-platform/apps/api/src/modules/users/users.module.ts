import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { UsersController } from './presentation/controllers/users.controller'
import { GetMeUseCase } from './application/use-cases/get-me.use-case'
import { UpdateProfileUseCase } from './application/use-cases/update-profile.use-case'
import { UpdateSettingsUseCase } from './application/use-cases/update-settings.use-case'
import { ListSessionsUseCase } from './application/use-cases/list-sessions.use-case'
import { RevokeSessionUseCase } from './application/use-cases/revoke-session.use-case'
import { PrismaUserProfileRepository } from './infrastructure/repositories/user-profile.prisma'
import { PrismaUserSessionRepository } from './infrastructure/repositories/user-session.prisma'
import { USER_PROFILE_REPOSITORY } from './domain/repositories/user-profile.repository'
import { USER_SESSION_REPOSITORY } from './domain/repositories/user-session.repository'

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    GetMeUseCase, UpdateProfileUseCase, UpdateSettingsUseCase, ListSessionsUseCase, RevokeSessionUseCase,
    { provide: USER_PROFILE_REPOSITORY, useClass: PrismaUserProfileRepository },
    { provide: USER_SESSION_REPOSITORY, useClass: PrismaUserSessionRepository },
  ],
})
export class UsersModule {}
