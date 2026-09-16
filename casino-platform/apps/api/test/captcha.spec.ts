import { ConfigService } from '@nestjs/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CaptchaService } from '../src/modules/auth/infrastructure/services/captcha.service'
import { CaptchaFailedError, CaptchaRequiredError } from '../src/modules/auth/domain/errors'

/**
 * GAP-55 (ж) §5.2: капча после 5 неудачных входов.
 * Проверяются решения, а не HTTP: транспорт подменён, сети тесты не касаются.
 * Отдельно фиксируются обе политики: fail-OPEN при сбое провайдера и
 * «без ключей механизм выключен» (иначе dev/CI остаются без входа вообще).
 */
interface Harness {
  service: CaptchaService
  transport: ReturnType<typeof vi.fn>
}

function harness(keys: { site?: string; secret?: string; threshold?: string }): Harness {
  const values: Record<string, string | undefined> = {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: keys.site,
    TURNSTILE_SECRET_KEY: keys.secret,
    CAPTCHA_AFTER_FAILED_ATTEMPTS: keys.threshold,
  }
  const config = { get: (key: string) => values[key] } as unknown as ConfigService
  const service = new CaptchaService(config)
  const transport = vi.fn()
  service.transport = transport
  return { service, transport }
}

const KEYS = { site: '0x4AAA_site', secret: '0x4AAA_secret' }

describe('GAP-55 CaptchaService: включён/выключен и порог', () => {
  it('без любого из ключей механизм выключен и никогда не требует капчу', () => {
    expect(harness({ site: KEYS.site }).service.enabled).toBe(false)
    expect(harness({ secret: KEYS.secret }).service.enabled).toBe(false)
    expect(harness({}).service.isRequiredFor(99)).toBe(false)
    expect(harness(KEYS).service.isRequiredFor(99)).toBe(true)
  })

  it('порог по умолчанию 5 (§5.2), переопределяется env', () => {
    expect(harness(KEYS).service.threshold).toBe(5)
    expect(harness({ ...KEYS, threshold: '3' }).service.threshold).toBe(3)
    expect(harness({ ...KEYS, threshold: 'abc' }).service.threshold).toBe(5)
  })
})

describe('GAP-55 CaptchaService: решение о капче', () => {
  let h: Harness

  beforeEach(() => {
    h = harness(KEYS)
  })

  it('ниже порога — капча не нужна и провайдер не дёргается', async () => {
    expect(h.service.isRequiredFor(4)).toBe(false)
    expect(h.service.isRequiredFor(5)).toBe(true)
  })

  it('нужна, но токена нет — CAPTCHA_REQUIRED без обращения к провайдеру', async () => {
    await expect(h.service.verify(undefined)).rejects.toThrow(CaptchaRequiredError)
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('пустой токен приравнивается к отсутствию', async () => {
    await expect(h.service.verify('   ')).rejects.toThrow(CaptchaRequiredError)
  })

  it('success=false от провайдера — CAPTCHA_FAILED', async () => {
    h.transport.mockResolvedValueOnce({ success: false, 'error-codes': ['invalid-input-response'] })
    await expect(h.service.verify('token-1')).rejects.toThrow(CaptchaFailedError)
  })

  it('сбой сети/таймаут — fail-open: вход пропускается, ошибка не показывается', async () => {
    h.transport.mockRejectedValueOnce(new Error('ETIMEDOUT'))
    await expect(h.service.verify('token-1')).resolves.toBeUndefined()
  })

  it('успех — токен уходит провайдеру с секретом, вход продолжается', async () => {
    h.transport.mockResolvedValueOnce({ success: true })
    await expect(h.service.verify('token-1')).resolves.toBeUndefined()
    const [url, init] = h.transport.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toContain('challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init.body).toContain('secret=0x4AAA_secret')
    expect(init.body).toContain('response=token-1')
  })

  it('HTTP-ответ не-JSON не роняет вход (тоже fail-open)', async () => {
    h.transport.mockRejectedValueOnce(new Error('siteverify HTTP 503'))
    await expect(h.service.verify('token-1')).resolves.toBeUndefined()
  })
})
