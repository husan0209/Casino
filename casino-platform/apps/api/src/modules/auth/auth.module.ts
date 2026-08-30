import { Module } from '@nestjs/common'

import { QueuesModule } from '../../queues/queues.module'
import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case'
import { LoginUseCase } from './application/use-cases/login.use-case'
import { LogoutUseCase } from './application/use-cases/logout.use-case'
import { GoogleOAuthUseCase } from './application/use-cases/oauth/google-oauth.use-case'
import { TelegramLoginUseCase } from './application/use-cases/oauth/telegram-login.use-case'
import { RefreshUseCase } from './application/use-cases/refresh.use-case'
import { RegisterUseCase } from './application/use-cases/register.use-case'
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case'
import { VerifyEmailUseCase } from './application/use-cases/verify-email.use-case'
import { AUTH_PROVIDER_REPOSITORY } from './domain/repositories/auth-provider.repository'
import { SESSION_REPOSITORY } from './domain/repositories/session.repository'
import { USER_SETTINGS_REPOSITORY } from './domain/repositories/user-settings.repository'
import { USER_REPOSITORY } from './domain/repositories/user.repository'
import {
  EMAIL_VERIFICATION_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
} from './domain/repositories/verification-token.repository'
import { PrismaAuthProviderRepository } from './infrastructure/repositories/auth-provider.repository.prisma'
import { PrismaSessionRepository } from './infrastructure/repositories/session.repository.prisma'
import { PrismaUserSettingsRepository } from './infrastructure/repositories/user-settings.repository.prisma'
import { PrismaUserRepository } from './infrastructure/repositories/user.repository.prisma'
import {
  PrismaEmailVerificationRepository,
  PrismaPasswordResetRepository,
} from './infrastructure/repositories/verification.repository.prisma'
import { EmailQueueService } from './infrastructure/services/email-queue.service'
import { JwtTokenService } from './infrastructure/services/jwt.service'
import { PasswordHasher } from './infrastructure/services/password-hasher.service'
import { AuthController } from './presentation/controllers/auth.controller'
import { AuthGuard } from './presentation/guards/auth.guard'
import { RolesGuard } from './presentation/guards/roles.guard'

@Module({
  imports: [QueuesModule],
  controllers: [AuthController],
  providers: [
    PasswordHasher,
    JwtTokenService,
    EmailQueueService,
    AuthGuard,
    RolesGuard,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: AUTH_PROVIDER_REPOSITORY, useClass: PrismaAuthProviderRepository },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: USER_SETTINGS_REPOSITORY, useClass: PrismaUserSettingsRepository },
    { provide: EMAIL_VERIFICATION_REPOSITORY, useClass: PrismaEmailVerificationRepository },
    { provide: PASSWORD_RESET_REPOSITORY, useClass: PrismaPasswordResetRepository },
    RegisterUseCase,
    VerifyEmailUseCase,
    LoginUseCase,
    RefreshUseCase,
    LogoutUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    GoogleOAuthUseCase,
    TelegramLoginUseCase,
  ],
  exports: [AuthGuard, RolesGuard, JwtTokenService],
})
export class AuthModule {}
