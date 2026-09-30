/**
 * Публичные endpoints партнёрской программы: регистрация и вход
 * (UC-AFF-01, UC-AFF-02; ТЗ ч.8 §10.1).
 *
 * Отдельный контроллер от кабинета: здесь нет guard'а AffiliateAuthGuard, зато
 * есть жёсткий throttle. Брутфорс партнёрских аккаунтов — реальный вектор
 * (топ-1 источник слитых учёток в affiliate-вертикали).
 */
import { Body, Controller, Get, Inject, Post, UsePipes } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { AffiliateSettingsService } from '../../application/affiliate-settings.service'
import { LoginAffiliateUseCase } from '../../application/use-cases/login-affiliate.use-case'
import { RegisterAffiliateUseCase } from '../../application/use-cases/register-affiliate.use-case'
import {
  LoginAffiliateSchema,
  RegisterAffiliateSchema,
  type LoginAffiliateDto,
  type RegisterAffiliateDto,
} from '../dto/affiliate.dto'

@Controller('affiliate')
export class AffiliateAuthController {
  constructor(
    @Inject(RegisterAffiliateUseCase) private readonly registerUseCase: RegisterAffiliateUseCase,
    @Inject(LoginAffiliateUseCase) private readonly loginUseCase: LoginAffiliateUseCase,
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
  ) {}

  /**
   * Публичные условия программы. Партнёру нужны до регистрации: сколько он
   * получит, за что начисляется, какой срок cookie-окна.
   */
  @Get('program')
  async program(): Promise<{
    revshare_rate: string
    cookie_days: number
    terms_version: string
    enabled: boolean
  }> {
    const settings = await this.settings.get()
    return {
      revshare_rate: settings.defaultRevshareRate,
      cookie_days: settings.cookieDays,
      terms_version: settings.termsVersion,
      enabled: settings.isEnabled,
    }
  }

  @Post('register')
  @Throttle({
    default: {
      limit: Number(process.env['THROTTLE_AFFILIATE_REGISTER_LIMIT'] ?? 5),
      ttl: Number(process.env['THROTTLE_TTL_MS'] ?? 60_000),
    },
  })
  @UsePipes(new ZodValidationPipe(RegisterAffiliateSchema))
  async register(@Body() body: RegisterAffiliateDto): Promise<{
    affiliate_id: string
    tracking_code: string
    tracking_url: string
    revshare_rate: string
    access_token: string
    message: string
  }> {
    // Явное сопоставление: DTO — snake_case (API_CONVENTIONS §1.2), вход
    // use-case — camelCase. Без маппинга accept_terms/display_name не дойдут
    // до домена и регистрация вернёт 400/неверные данные.
    const result = await this.registerUseCase.execute({
      email: body.email,
      password: body.password,
      displayName: body.display_name,
      telegram: body.telegram,
      website: body.website,
      acceptTerms: body.accept_terms,
    })
    return {
      affiliate_id: result.affiliateId,
      tracking_code: result.trackingCode,
      tracking_url: result.trackingUrl,
      revshare_rate: result.revshareRate,
      access_token: result.accessToken,
      message: result.message,
    }
  }

  @Post('login')
  @Throttle({
    default: {
      limit: Number(process.env['THROTTLE_AFFILIATE_LOGIN_LIMIT'] ?? 10),
      ttl: Number(process.env['THROTTLE_TTL_MS'] ?? 60_000),
    },
  })
  @UsePipes(new ZodValidationPipe(LoginAffiliateSchema))
  async login(@Body() body: LoginAffiliateDto): Promise<{
    affiliate_id: string
    tracking_code: string
    tracking_url: string
    revshare_rate: string
    status: string
    access_token: string
  }> {
    const result = await this.loginUseCase.execute(body)
    return {
      affiliate_id: result.affiliateId,
      tracking_code: result.trackingCode,
      tracking_url: result.trackingUrl,
      revshare_rate: result.revshareRate,
      status: result.status,
      access_token: result.accessToken,
    }
  }
}
