import { Body, Controller, Get, Post, Query, Req, Res, UsePipes } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { type Request, Response } from 'express'

import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from '@/common/cookies/refresh-token-cookie'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { ForgotPasswordUseCase } from '../../application/use-cases/forgot-password.use-case'
import { LoginUseCase } from '../../application/use-cases/login.use-case'
import { LogoutUseCase } from '../../application/use-cases/logout.use-case'
import { GoogleOAuthUseCase } from '../../application/use-cases/oauth/google-oauth.use-case'
import { TelegramLoginUseCase } from '../../application/use-cases/oauth/telegram-login.use-case'
import { RefreshUseCase } from '../../application/use-cases/refresh.use-case'
import { RegisterUseCase } from '../../application/use-cases/register.use-case'
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case'
import { VerifyEmailUseCase } from '../../application/use-cases/verify-email.use-case'
import { LoginSchema, type LoginDto } from '../dto/login.dto'
import { GoogleLoginSchema, TelegramLoginSchema } from '../dto/oauth.dto'
import { ForgotPasswordSchema, ResetPasswordSchema } from '../dto/password-reset.dto'
import { RegisterSchema, type RegisterDto } from '../dto/register.dto'

@Controller('auth')
// GAP-19: брутфорс-защита логина/регистрации — строже глобального лимита.
@Throttle({
  default: {
    limit: Number(process.env['THROTTLE_AUTH_LIMIT'] ?? 10),
    ttl: Number(process.env['THROTTLE_TTL_MS'] ?? 60_000),
  },
})
export class AuthController {
  constructor(
    private readonly registerUc: RegisterUseCase,
    private readonly verifyUc: VerifyEmailUseCase,
    private readonly loginUc: LoginUseCase,
    private readonly refreshUc: RefreshUseCase,
    private readonly logoutUc: LogoutUseCase,
    private readonly forgotUc: ForgotPasswordUseCase,
    private readonly resetUc: ResetPasswordUseCase,
    private readonly googleUc: GoogleOAuthUseCase,
    private readonly telegramUc: TelegramLoginUseCase,
  ) {}

  @Post('register')
  @UsePipes(new ZodValidationPipe(RegisterSchema))
  async register(
    @Body() body: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.registerUc.execute(
      { email: body.email, password: body.password, referralCode: body.referral_code },
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user, referralCode: result.referralCode }
  }

  @Get('verify-email')
  async verify(@Query('token') token: string, @Req() req: Request) {
    const result = await this.verifyUc.execute(token, req.ip, req.headers['user-agent'])
    return result
  }

  @Post('login')
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.loginUc.execute({
      email: body.email,
      password: body.password,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Refresh token lives only in the httpOnly cookie. Accepting it from the
    // request body weakens CSRF protection and breaks the cookie-based rotation
    // contract — do not reintroduce the body fallback.
    const token = req.cookies.refresh_token
    const result = await this.refreshUc.execute(token)
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (req.user?.sessionId) {
      await this.logoutUc.execute(req.user.sessionId)
    }
    clearRefreshTokenCookie(res)
    return { ok: true }
  }

  @Post('forgot-password')
  @UsePipes(new ZodValidationPipe(ForgotPasswordSchema))
  async forgot(@Body() body: { email: string }) {
    return this.forgotUc.execute(body.email)
  }

  @Post('reset-password')
  @UsePipes(new ZodValidationPipe(ResetPasswordSchema))
  async reset(@Body() body: { token: string; new_password: string }) {
    return this.resetUc.execute(body.token, body.new_password)
  }

  // ===== OAuth (TZ part 2) =====

  @Get('google/url')
  googleUrl(@Query('redirect_uri') redirectUri?: string) {
    return this.googleUc.buildAuthUrl(redirectUri)
  }

  @Post('google')
  @UsePipes(new ZodValidationPipe(GoogleLoginSchema))
  async google(
    @Body() body: { code: string; redirect_uri?: string; state?: string; referral_code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.googleUc.execute({
      code: body.code,
      redirectUri: body.redirect_uri,
      state: body.state,
      referralCode: body.referral_code as string | undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  @Post('telegram')
  @UsePipes(new ZodValidationPipe(TelegramLoginSchema))
  async telegram(
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.telegramUc.execute(
      payload as unknown as Parameters<typeof this.telegramUc.execute>[0],
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
    setRefreshTokenCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }
}
