import { Body, Controller, Get, Post, Query, Req, Res, UsePipes } from '@nestjs/common'
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe'
import { RegisterSchema } from '../dto/register.dto'
import { LoginSchema } from '../dto/login.dto'
import { RegisterUseCase } from '../../application/use-cases/register.use-case'
import { VerifyEmailUseCase } from '../../application/use-cases/verify-email.use-case'
import { LoginUseCase } from '../../application/use-cases/login.use-case'
import { RefreshUseCase } from '../../application/use-cases/refresh.use-case'
import { LogoutUseCase } from '../../application/use-cases/logout.use-case'
import { ForgotPasswordUseCase } from '../../application/use-cases/forgot-password.use-case'
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case'
import type { Request, Response } from 'express'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUc: RegisterUseCase,
    private readonly verifyUc: VerifyEmailUseCase,
    private readonly loginUc: LoginUseCase,
    private readonly refreshUc: RefreshUseCase,
    private readonly logoutUc: LogoutUseCase,
    private readonly forgotUc: ForgotPasswordUseCase,
    private readonly resetUc: ResetPasswordUseCase,
  ) {}

  @Post('register')
  @UsePipes(new ZodValidationPipe(RegisterSchema))
  async register(@Body() body: any) {
    return this.registerUc.execute({ email: body.email, password: body.password, referralCode: body.referral_code })
  }

  @Get('verify-email')
  async verify(@Query('token') token: string, @Req() req: Request) {
    const result = await this.verifyUc.execute(token, req.ip, req.headers['user-agent'])
    return result
  }

  @Post('login')
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.loginUc.execute({
      email: body.email, password: body.password,
      ip: req.ip, userAgent: req.headers['user-agent']
    })
    res.cookie('refresh_token', result.refreshToken, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: 30*24*3600*1000 })
    return { accessToken: result.accessToken, user: result.user }
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies?.refresh_token) || req.body?.refreshToken
    const result = await this.refreshUc.execute(token)
    res.cookie('refresh_token', result.refreshToken, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: 30*24*3600*1000 })
    return { accessToken: result.accessToken }
  }

  @Post('logout')
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    if (req.user?.sessionId) await this.logoutUc.execute(req.user.sessionId)
    res.clearCookie('refresh_token')
    return { ok: true }
  }

  @Post('forgot-password')
  async forgot(@Body() body: { email: string }) {
    return this.forgotUc.execute(body.email)
  }

  @Post('reset-password')
  async reset(@Body() body: { token: string; new_password: string }) {
    return this.resetUc.execute(body.token, body.new_password)
  }

  @Post('google')
  async google() { return { error: 'GOOGLE_OAUTH_NOT_CONFIGURED' } }

  @Post('telegram')
  async telegram() { return { error: 'TELEGRAM_LOGIN_NOT_CONFIGURED' } }
}
