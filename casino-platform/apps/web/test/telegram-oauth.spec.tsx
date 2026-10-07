import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UC-AUTH-09: вход через Telegram без виджета.
 * - telegramAuthorizeUrl строит адрес нативной кнопки (oauth.telegram.org/auth)
 *   и молчит, если id бота не настроен;
 * - тихий ?ref= едет ВНУТРИ return_to: провайдер наклеивает результат ровно на
 *   переданный URL и query исходной страницы не переносит;
 * - write-доступ (request_access) не просим;
 * - telegramPayloadFromHash разбирает #tgAuthResult так же, как upstream
 *   telegram-widget.js (base64url → atob → JSON.parse), и мусор не роняет
 *   страницу;
 * - exchange/preview шлют один набор полей и не пропускают ответ без конверта.
 */

vi.hoisted(() => {
  process.env['NEXT_PUBLIC_TELEGRAM_BOT_NAME'] = 'test_bot'
  process.env['NEXT_PUBLIC_TELEGRAM_BOT_ID'] = '1234567890'
})

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

vi.mock('@/lib/api', () => api)

import {
  exchangeTelegramAuth,
  previewTelegramAuth,
  TelegramOAuthPlate,
  telegramAuthorizeUrl,
  telegramPayloadFromHash,
  telegramPayloadFromQuery,
} from '@/components/auth/oauth'

/** base64url от JSON, как его отдаёт Telegram. */
const tgHash = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload)).toString('base64url')

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiPost.mockReset()
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('telegramAuthorizeUrl', () => {
  it('собирает адрес авторизации с id бота, origin и русским языком', () => {
    const url = new URL(telegramAuthorizeUrl() as string)

    expect(url.origin + url.pathname).toBe('https://oauth.telegram.org/auth')
    expect(url.searchParams.get('bot_id')).toBe('1234567890')
    expect(url.searchParams.get('origin')).toBe(window.location.origin)
    expect(url.searchParams.get('lang')).toBe('ru')
    expect(url.searchParams.get('return_to')).toBe(
      `${window.location.origin}/auth/telegram/callback`,
    )
  })

  /**
   * Тот же дефект, что был у виджета: провайдер возвращает на РОВНО return_to,
   * поэтому ref партнёра обязан быть зашит в него, иначе игрок придёт без
   * реферера.
   */
  it('вшивает тихий ?ref= в return_to', () => {
    const url = new URL(telegramAuthorizeUrl('REF9') as string)

    expect(url.searchParams.get('return_to')).toBe(
      `${window.location.origin}/auth/telegram/callback?ref=REF9`,
    )
  })

  it('не просит request_access=write — вход не даёт боту прав на аккаунт', () => {
    expect(telegramAuthorizeUrl('REF9')).not.toContain('request_access')
  })

  /**
   * Env читается на импорт, поэтому случай проверяем в свежем модуле. Пустая
   * строка — это ровно то, что передаёт compose (`${VAR:-}`), и с ней кнопка
   * должна гаснуть, а не вести на `/auth?bot_id=`.
   */
  it('без id бота возвращает null и никуда не ведёт', async () => {
    vi.stubEnv('NEXT_PUBLIC_TELEGRAM_BOT_ID', '')
    vi.resetModules()
    const mod = await import('@/components/auth/oauth')

    expect(mod.TELEGRAM_BOT_ID).toBeUndefined()
    expect(mod.telegramAuthorizeUrl('REF9')).toBeNull()

    vi.unstubAllEnvs()
  })
})

describe('telegramPayloadFromHash', () => {
  /**
   * Две кодировки, которые реально встречаются: Telegram может отдать кириллицу
   * и байтами UTF-8, и \u-экранированием внутри ASCII. onauth-путь виджета
   * разобрал бы вторую, но первую превратил бы в mojibake — а он поехал бы
   * обратно в API, где по first_name считается подпись.
   */
  it('разбирает #tgAuthResult с кириллицей в любом виде кодировки', () => {
    const escaped = `{"id":42,"auth_date":1690000000,"hash":"HASH1","first_name":"\\u0418\\u0432\\u0430\\u043d"}`
    const variants = [
      tgHash({ id: 42, auth_date: 1690000000, hash: 'HASH1', first_name: 'Иван' }),
      Buffer.from(escaped).toString('base64url'),
    ]

    for (const encoded of variants) {
      window.history.replaceState(null, '', `/auth/telegram/callback#tgAuthResult=${encoded}`)

      expect(telegramPayloadFromHash()).toEqual({
        id: 42,
        auth_date: 1690000000,
        hash: 'HASH1',
        first_name: 'Иван',
      })
    }
  })

  it('без хэша, с мусором и без обязательных полей — null, а не исключение', () => {
    window.history.replaceState(null, '', '/auth/telegram/callback')
    expect(telegramPayloadFromHash()).toBeNull()

    window.history.replaceState(null, '', '/auth/telegram/callback#tgAuthResult=***')
    expect(telegramPayloadFromHash()).toBeNull()

    window.history.replaceState(
      null,
      '',
      `/auth/telegram/callback#tgAuthResult=${tgHash({ id: 42, auth_date: 1 })}`,
    )
    expect(telegramPayloadFromHash()).toBeNull()

    window.history.replaceState(
      null,
      '',
      `/auth/telegram/callback#tgAuthResult=${tgHash('не объект')}`,
    )
    expect(telegramPayloadFromHash()).toBeNull()
  })
})

describe('плашка Telegram', () => {
  /**
   * Кнопка наша: никакого iframe и скрипта telegram.org в странице — именно ради
   * этого виджет и убран (стили iframe недоступны, колбэк требует eval).
   */
  it('это текст со знаком, а не iframe', () => {
    render(
      <button type="button">
        <TelegramOAuthPlate />
      </button>,
    )

    expect(screen.getByRole('button').textContent).toContain('Продолжить с Telegram')
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('script[src*="telegram-widget"]')).toBeNull()
  })
})

describe('exchangeTelegramAuth', () => {
  it('преобразует id и auth_date виджета в строки и передаёт referral_code', async () => {
    api.apiPost.mockResolvedValue({ accessToken: 'token', user: { id: 'u1' } })

    await exchangeTelegramAuth(
      { id: 42, auth_date: 1690000000, hash: 'HASH1', first_name: 'Иван' },
      'REF9',
    )

    expect(api.apiPost).toHaveBeenCalledWith('/auth/telegram', {
      id: '42',
      auth_date: '1690000000',
      hash: 'HASH1',
      first_name: 'Иван',
      last_name: undefined,
      username: undefined,
      photo_url: undefined,
      referral_code: 'REF9',
    })
  })
})

describe('ответ API без конверта {success,data}', () => {
  const payload = { id: '42', auth_date: '1690000000', hash: 'HASH1' }

  it('preview бросает внятную ошибку, а не отдаёт undefined', async () => {
    api.apiPost.mockResolvedValue(undefined)

    await expect(previewTelegramAuth(payload)).rejects.toThrow(/неожиданный ответ/)
  })

  it('обмен на сессию тоже проверяет форму ответа', async () => {
    api.apiPost.mockResolvedValue(undefined)

    await expect(exchangeTelegramAuth(payload)).rejects.toThrow(/неожиданный ответ/)
  })
})

describe('telegramPayloadFromQuery', () => {
  it('собирает payload из query колбэка (redirect-режим виджета)', () => {
    const query = new URLSearchParams(
      'id=42&auth_date=1690000000&hash=HASH1&first_name=Иван&photo_url=https%3A%2F%2Ft.me%2Fi.jpg&ref=REF9',
    )

    expect(telegramPayloadFromQuery(query)).toEqual({
      id: '42',
      auth_date: '1690000000',
      hash: 'HASH1',
      first_name: 'Иван',
      last_name: undefined,
      username: undefined,
      photo_url: 'https://t.me/i.jpg',
    })
  })

  it('без hash/id/auth_date возвращает null — обмен не начинать', () => {
    expect(telegramPayloadFromQuery(new URLSearchParams('id=42&auth_date=1'))).toBeNull()
    expect(telegramPayloadFromQuery(new URLSearchParams())).toBeNull()
  })
})
