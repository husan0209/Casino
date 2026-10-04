import { Module } from '@nestjs/common'

import { QueuesModule } from '../../queues/queues.module'
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case'
import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case'
import { ListTermsAcceptancesUseCase } from './application/use-cases/list-terms-acceptances.use-case'
import { LoginUseCase } from './application/use-cases/login.use-case'
import { LogoutUseCase } from './application/use-cases/logout.use-case'
import { GoogleOAuthUseCase } from './application/use-cases/oauth/google-oauth.use-case'
import { OAuthUserProvisioningService } from './application/use-cases/oauth/oauth-user-provisioning.service'
import { TelegramLoginUseCase } from './application/use-cases/oauth/telegram-login.use-case'
import { RefreshUseCase } from './application/use-cases/refresh.use-case'
import { RegisterUseCase } from './application/use-cases/register.use-case'
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case'
import { VerifyEmailUseCase } from './application/use-cases/verify-email.use-case'
import {
  CAPTCHA_SERVICE,
  EMAIL_QUEUE_SERVICE,
  JWT_TOKEN_SERVICE,
  PASSWORD_HASHER,
} from './domain/auth.ports'
import { AUTH_PROVIDER_REPOSITORY } from './domain/repositories/auth-provider.repository'
import { SESSION_REPOSITORY } from './domain/repositories/session.repository'
import { TERMS_ACCEPTANCE_REPOSITORY } from './domain/repositories/terms-acceptance.repository'
import { USER_SETTINGS_REPOSITORY } from './domain/repositories/user-settings.repository'
import { USER_REPOSITORY } from './domain/repositories/user.repository'
import {
  EMAIL_VERIFICATION_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
} from './domain/repositories/verification-token.repository'
import { PrismaAuthProviderRepository } from './infrastructure/repositories/auth-provider.repository.prisma'
import { PrismaSessionRepository } from './infrastructure/repositories/session.repository.prisma'
import { PrismaTermsAcceptanceRepository } from './infrastructure/repositories/terms-acceptance.repository.prisma'
import { PrismaUserSettingsRepository } from './infrastructure/repositories/user-settings.repository.prisma'
import { PrismaUserRepository } from './infrastructure/repositories/user.repository.prisma'
import {
  PrismaEmailVerificationRepository,
  PrismaPasswordResetRepository,
} from './infrastructure/repositories/verification.repository.prisma'
import { CaptchaService } from './infrastructure/services/captcha.service'
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
    // Класс-токены остаются: presentation (auth.guard) и внешний
    // common/guards/optional-auth.guard внедряют JwtTokenService напрямую,
    // а сам он — в exports модуля (MODULE_BOUNDARIES §2.5).
    PasswordHasher,
    JwtTokenService,
    CaptchaService,
    EmailQueueService,
    AuthGuard,
    RolesGuard,
    // В5: application-слой получает infrastructure только через порты
    // (DI-токены). useExisting — тот же экземпляр, что и у класс-токена
    // (образец: payments.module.ts).
    { provide: PASSWORD_HASHER, useExisting: PasswordHasher },
    { provide: JWT_TOKEN_SERVICE, useExisting: JwtTokenService },
    { provide: CAPTCHA_SERVICE, useExisting: CaptchaService },
    { provide: EMAIL_QUEUE_SERVICE, useExisting: EmailQueueService },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: AUTH_PROVIDER_REPOSITORY, useClass: PrismaAuthProviderRepository },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: USER_SETTINGS_REPOSITORY, useClass: PrismaUserSettingsRepository },
    { provide: EMAIL_VERIFICATION_REPOSITORY, useClass: PrismaEmailVerificationRepository },
    { provide: PASSWORD_RESET_REPOSITORY, useClass: PrismaPasswordResetRepository },
    { provide: TERMS_ACCEPTANCE_REPOSITORY, useClass: PrismaTermsAcceptanceRepository },
    RegisterUseCase,
    ListTermsAcceptancesUseCase,
    VerifyEmailUseCase,
    LoginUseCase,
    RefreshUseCase,
    LogoutUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    ChangePasswordUseCase,
    GoogleOAuthUseCase,
    TelegramLoginUseCase,
    // NB: инжектится GoogleOAuthUseCase/TelegramLoginUseCase; был забыт в providers —
    // собранный сервер падал на DI (найдено E2E-шагом, см. PR #15)
    OAuthUserProvisioningService,
  ],
  exports: [AuthGuard, RolesGuard, JwtTokenService],
})
export class AuthModule {}
