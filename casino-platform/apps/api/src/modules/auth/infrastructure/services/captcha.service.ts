import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { CaptchaFailedError, CaptchaRequiredError } from '../../domain/errors'

/**
 * GAP-55 (ж) (ТЗ ч.5 §5.2): «после 5 неудач — captcha» на входе.
 *
 * Провайдер — Cloudflare Turnstile (решение агента по делегированию владельца;
 * фиксирую обоснование: бесплатно, без картинок-головоломок, виджет и siteverify
 * не требуют SDK, обычно доступен в СНГ; заменить на hCaptcha/reCAPTCHA — один
 * файл: другие URL и имя поля токена).
 *
 * КЛЮЧЕВЫЕ ПОЛИТИКИ (обе — осознанные, задокументированы в трекере):
 *  - enabled = есть И siteKey, И secretKey. Без ключей механизм выключен: капча
 *    не должна ломать вход там, где её не настраивали (dev/CI/тесты).
 *  - fail-OPEN при сбое сети провайдера: капча — второй слой, основной барьер
 *    уже стоит (GAP-18 lockout 10 неудач/15 мин + throttler GAP-19 10/мин на
 *    /auth). fail-closed превратил бы недоступность Cloudflare в отказ всего
 *    логина — это отказоустойчивость хуже, чем риск.
 *  - явный отказ провайдера (success=false) — отбиваем (CaptchaFailedError).
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 5_000

export interface CaptchaVerifyResponse {
  success: boolean
  'error-codes'?: string[]
}

export type CaptchaTransport = (url: string, init: RequestInit) => Promise<CaptchaVerifyResponse>

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name)

  /** Подменяется в тестах, чтобы не бить по сети. */
  transport: CaptchaTransport = defaultTransport

  constructor(private readonly config: ConfigService) {}

  get siteKey(): string {
    return this.config.get<string>('NEXT_PUBLIC_TURNSTILE_SITE_KEY') ?? ''
  }

  get enabled(): boolean {
    return this.siteKey.length > 0 && this.secretKey.length > 0
  }

  /** Порог ТЗ §5.2 — 5 неудач; lockout GAP-18 срабатывает позже (10). */
  get threshold(): number {
    const raw = this.config.get<string>('CAPTCHA_AFTER_FAILED_ATTEMPTS')
    const parsed = raw === undefined || raw === '' ? NaN : Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
  }

  /**
   * Обязательна ли капча при текущем счётчике неудач.
   * Выключенный механизм никогда не требует токен — иначе вход сломается молча.
   */
  isRequiredFor(failedAttempts: number): boolean {
    return this.enabled && failedAttempts >= this.threshold
  }

  /**
   * Проверка токена. Бросает CaptchaRequiredError, если токена нет, и
   * CaptchaFailedError, если провайдер ответил «не прошло». Сеть/таймаут —
   * warn + пропускаем (fail-open, см. докстринг класса).
   *
   * `remoteip` намеренно НЕ передаём: за NGINX мы видим адрес прокси, а
   * ложный IP в verification-запросе хуже отсутствия (источник ложных отказов).
   */
  async verify(token: string | undefined): Promise<void> {
    if (token === undefined || token.trim().length === 0) {
      throw new CaptchaRequiredError()
    }
    let verdict: CaptchaVerifyResponse
    try {
      verdict = await this.transport(VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: this.secretKey, response: token }).toString(),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      })
    } catch (error) {
      this.logger.warn(
        `captcha: провайдер недоступен, пропускаем без капчи (fail-open): ${
          (error as Error).message
        }`,
      )
      return
    }
    if (verdict.success !== true) {
      throw new CaptchaFailedError(verdict['error-codes']?.join(',') ?? 'invalid-input-response')
    }
  }

  private get secretKey(): string {
    return this.config.get<string>('TURNSTILE_SECRET_KEY') ?? ''
  }
}

async function defaultTransport(url: string, init: RequestInit): Promise<CaptchaVerifyResponse> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`siteverify HTTP ${String(response.status)}`)
  }
  return (await response.json()) as CaptchaVerifyResponse
}
