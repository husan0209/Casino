import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { type Request, type Response } from 'express'

import {
  OAUTH_STATE_COOKIE,
  clearOAuthStateCookie,
  setOAuthStateCookie,
} from '@/common/cookies/oauth-state-cookie'
import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from '@/common/cookies/refresh-token-cookie'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type UserActor } from '@/common/types/req-user'

import { type UserRole } from '@casino/database'

import { ChangePasswordUseCase } from '../../application/use-cases/change-password.use-case'
import { ForgotPasswordUseCase } from '../../application/use-cases/forgot-password.use-case'
import { LoginUseCase } from '../../application/use-cases/login.use-case'
import { LogoutUseCase } from '../../application/use-cases/logout.use-case'
import { GoogleOAuthUseCase } from '../../application/use-cases/oauth/google-oauth.use-case'
import { TelegramLoginUseCase } from '../../application/use-cases/oauth/telegram-login.use-case'
import { RefreshUseCase } from '../../application/use-cases/refresh.use-case'
import { RegisterUseCase } from '../../application/use-cases/register.use-case'
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case'
import { VerifyEmailUseCase } from '../../application/use-cases/verify-email.use-case'
import { type LoginDto, LoginSchema } from '../dto/login.dto'
import { GoogleLoginSchema, TelegramLoginSchema } from '../dto/oauth.dto'
import {
  ChangePasswordSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from '../dto/password-reset.dto'
import { type RegisterDto, RegisterSchema } from '../dto/register.dto'
import { AuthGuard } from '../guards/auth.guard'

/** Точечное сужение: req.cookies в @types/express — any (GAP-39 stage 10). */
interface RequestWithCookies {
  cookies: Record<string, string | undefined>
}

@Controller('auth')
// GAP-19: брутфорс-защита логина/регистрации — строже глобального лимита.
@Throttle({
  default: {
    limit: Number(process.env['THROTTLE_AUTH_LIMIT'] ?? 10),
    ttl: Number(process.env['THROTTLE_TTL_MS'] ?? 60_000),
  },
})
export class AuthController {
  // Явный @Inject на КАЖДОЙ зависимости обязателен (CONVENTIONS.md §1.4): в этой
  // сборке TypeScript 6 не выдаёт design:paramtypes, поэтому инъекция «по типу»
  // молча передаёт undefined — весь /auth/* отдавал 500. Тип-импорты выше
  // заменены на обычные: для @Inject нужен рантайм-объект класса.
  constructor(
    @Inject(RegisterUseCase) private readonly registerUc: RegisterUseCase,
    @Inject(VerifyEmailUseCase) private readonly verifyUc: VerifyEmailUseCase,
    @Inject(LoginUseCase) private readonly loginUc: LoginUseCase,
    @Inject(RefreshUseCase) private readonly refreshUc: RefreshUseCase,
    @Inject(LogoutUseCase) private readonly logoutUc: LogoutUseCase,
    @Inject(ForgotPasswordUseCase) private readonly forgotUc: ForgotPasswordUseCase,
    @Inject(ResetPasswordUseCase) private readonly resetUc: ResetPasswordUseCase,
    @Inject(ChangePasswordUseCase) private readonly changePasswordUc: ChangePasswordUseCase,
    @Inject(GoogleOAuthUseCase) private readonly googleUc: GoogleOAuthUseCase,
    @Inject(TelegramLoginUseCase) private readonly telegramUc: TelegramLoginUseCase,
  ) {}

  @Post('register')
  @UsePipes(new ZodValidationPipe(RegisterSchema))
  async register(
    @Body() body: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    accessToken: string
    user: { id: string; email: string | null; role: UserRole }
    referralCode: string
  }> {
    // Код партнёра из ?ref= (партнёрская программа, ТЗ ч.8 §7.3). Тот же
    // параметр используется и игровой рефералкой, но резолвится независимо:
    // player-ref ищется в users.referral_code, affiliate-код — в
    // affiliates.tracking_code. Совпадёт максимум один.
    const affiliateCode = typeof req.query['ref'] === 'string' ? req.query['ref'] : undefined
    const result = await this.registerUc.execute(
      { email: body.email, password: body.password, referralCode: body.referral_code },
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        affiliateCode,
      },
    )
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user, referralCode: result.referralCode }
  }

  @Get('verify-email')
  async verify(
    @Query('token') token: string,
    @Req() req: Request,
  ): Promise<{
    accessToken: string
    refreshToken: string
    user: { id: string; email: string | null; role: UserRole }
  }> {
    const result = await this.verifyUc.execute(token, req.ip, req.headers['user-agent'])
    return result
  }

  @Post('login')
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: { id: string; email: string | null; role: UserRole } }> {
    const result = await this.loginUc.execute({
      email: body.email,
      password: body.password,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      ...(body.captcha_token !== undefined && { captchaToken: body.captcha_token }),
    })
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  @Post('refresh')
  // P1 #11: refresh — это зонд восстановления сессии при КАЖДОЙ полной загрузке
  // страницы (в том числе у гостя: наличие httpOnly-cookie клиенту не видно),
  // поэтому классовый AUTH-лимит (10/мин, брутфорс login/register) ему тесен —
  // NAT/офис выхватывает 429 на ровном месте. Брутфорсить здесь нечего: без
  // валидного высокоэнтропийного refresh-токена запрос бесполезен. В проде
  // внешним ограничителем остаётся nginx api_auth 10r/m.
  @Throttle({
    default: {
      limit: Number(process.env['THROTTLE_REFRESH_LIMIT'] ?? 30),
      ttl: Number(process.env['THROTTLE_TTL_MS'] ?? 60_000),
    },
  })
  async refresh(
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    // Refresh token lives only in the httpOnly cookie. Accepting it from the
    // request body weakens CSRF protection and breaks the cookie-based rotation
    // contract — do not reintroduce the body fallback.
    const token = req.cookies.refresh_token ?? ''
    const result = await this.refreshUc.execute(token)
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken }
  }

  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    const user = req.user
    if (user && 'sessionId' in user && user.sessionId) {
      await this.logoutUc.execute(user.sessionId)
    }
    clearRefreshTokenCookie(res)
    return { ok: true }
  }

  @Post('forgot-password')
  @UsePipes(new ZodValidationPipe(ForgotPasswordSchema))
  async forgot(@Body() body: { email: string }): Promise<{ message: string }> {
    return this.forgotUc.execute(body.email)
  }

  @Post('reset-password')
  @UsePipes(new ZodValidationPipe(ResetPasswordSchema))
  async reset(@Body() body: { token: string; new_password: string }): Promise<{ ok: boolean }> {
    return this.resetUc.execute(body.token, body.new_password)
  }

  // GAP-52 (ТЗ ч.5 §9): смена пароля из профиля. AuthGuard обязателен —
  // в отличие от анонимных forgot/reset, здесь нужен залогиненный пользователь.
  @Post('change-password')
  @UseGuards(AuthGuard)
  @UsePipes(new ZodValidationPipe(ChangePasswordSchema))
  async changePassword(
    @CurrentUser() user: UserActor,
    @Body() body: { current_password: string; new_password: string },
  ): Promise<{ ok: boolean }> {
    return this.changePasswordUc.execute({
      userId: user.id,
      currentPassword: body.current_password,
      newPassword: body.new_password,
      currentSessionId: user.sessionId,
    })
  }

  // ===== OAuth (TZ part 2) =====

  @Get('google/url')
  googleUrl(
    @Query('redirect_uri') redirectUri: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): { url: string; state: string } {
    const result = this.googleUc.buildAuthUrl(redirectUri)
    // `state` возвращается клиенту (он кладёт его в тело) и запоминается кукой:
    // завершить вход может только тот браузер, который его начал. Подписанный
    // state сам по себе воспроизводим — см. oauth-state-cookie.ts.
    setOAuthStateCookie(res, result.state)
    return result
  }

  @Post('google')
  @UsePipes(new ZodValidationPipe(GoogleLoginSchema))
  async google(
    @Body() body: { code: string; redirect_uri?: string; state?: string; referral_code?: string },
    @Req() req: RequestWithCookies & Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: { id: string; email: string | null; role: string } }> {
    // `req.cookies` в @types/express объявлен как any (GAP-39, stage 10) — в
    // пересечении `RequestWithCookies & Request` это any и побеждает. Значение
    // берём через узкий интерфейс, иначе any уезжал бы в use-case мимо типов.
    const { cookies } = req as RequestWithCookies
    const result = await this.googleUc.execute({
      code: body.code,
      redirectUri: body.redirect_uri,
      state: body.state,
      stateCookie: cookies[OAUTH_STATE_COOKIE],
      referralCode: body.referral_code as string | undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
    // state одноразовый: пара (code, state) больше не переиспользуется.
    clearOAuthStateCookie(res)
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  @Post('telegram')
  @UsePipes(new ZodValidationPipe(TelegramLoginSchema))
  async telegram(
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: { id: string; email: string | null; role: string } }> {
    const result = await this.telegramUc.execute(
      payload as unknown as Parameters<typeof this.telegramUc.execute>[0],
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }
}
