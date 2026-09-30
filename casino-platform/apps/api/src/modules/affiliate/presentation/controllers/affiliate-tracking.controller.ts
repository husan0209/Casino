/**
 * Публичный трекинг кликов (UC-AFF-05, ТЗ ч.8 §7.2).
 *
 * ВЫнесен ОТДЕЛЬНО от остальных контроллеров по трём причинам:
 *  1. путь `/go/:code` лежит на корне домена, а не под `/api/v1` — партнёрская
 *     ссылка должна быть короткой и кликабельной;
 *  2. endpoint публичный, поэтому нужен собственный жёсткий rate limit:
 *     120/мин против глобальных 60/мин;
 *  3. ответ — 302 + cookie, а не JSON: браузер пользователя должен уйти на
 *     лендинг, а клиентский код ничего не должен разбирать.
 *
 * КРИТИЧНО: редирект происходит ВСЕГДА, даже если код неизвестен или партнёр
 * заблокирован. Ломать переход пользователя из-за проблем трекинга нельзя —
 * достаточно не ставить cookie.
 */
import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { type Request, type Response } from 'express'

import { TrackClickUseCase } from '../../application/use-cases/track-click.use-case'
import { TrackingCodeSchema } from '../dto/affiliate.dto'

/** Имя cookie атрибуции. Фронтенд читает его и дублирует в localStorage. */
export const AFFILIATE_COOKIE_NAME = 'aff_code'

/** Параметры deep-link из ссылки партнёра. */
interface TrackingQuery {
  p?: string | undefined
  c?: string | undefined
  s?: string | undefined
}

@Controller('go')
export class AffiliateTrackingController {
  constructor(@Inject(TrackClickUseCase) private readonly trackClick: TrackClickUseCase) {}

  /**
   * Обрабатывает клик по партнёрской ссылке.
   *
   * Код валидируется Zod-схемой; невалидный код не вызывает use case вообще —
   * это дешёвый отсев мусорного трафика (ботов, опечаток, сканеров).
   */
  @Get(':code')
  @Throttle({
    default: {
      limit: Number(process.env['THROTTLE_AFFILIATE_TRACKING_LIMIT'] ?? 120),
      ttl: Number(process.env['THROTTLE_TTL_MS'] ?? 60_000),
    },
  })
  async track(
    @Param('code') code: string,
    @Query() query: TrackingQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = TrackingCodeSchema.safeParse(code)
    if (!parsed.success) {
      response.redirect(302, '/casino')
      return
    }

    const result = await this.trackClick.execute({
      trackingCode: parsed.data,
      path: query.p,
      campaignId: query.c,
      subId: query.s,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      referer: request.get('referer'),
    })

    if (result.shouldSetCookie && result.cookieCode !== null) {
      // HttpOnly=false: фронтенд обязан прочитать код и положить в localStorage,
      // чтобы атрибуция пережила ITP-усечение cookie в Safari/Firefox.
      // Это публичный идентификатор партнёра, не секрет.
      response.cookie(AFFILIATE_COOKIE_NAME, result.cookieCode, {
        maxAge: result.cookieDays * 24 * 60 * 60 * 1000,
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/',
      })
    }

    // Редирект ОБЯЗАТЕЛЬНО абсолютный: `/go/:code` может отдаваться и API
    // (nginx), и вебом (прокси). Относительный путь браузер разрешил бы
    // относительно текущего origin — и при прокси через API пользователь ушёл
    // бы на api-origin/casino вместо витрины.
    response.redirect(302, this.absoluteUrl(result.redirectPath))
  }

  /** Домен витрины из APP_URL. */
  private absoluteUrl(path: string): string {
    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000'
    const base = appUrl.replace(/\/+$/, '')
    return `${base}${path.startsWith('/') ? path : `/${path}`}`
  }
}
