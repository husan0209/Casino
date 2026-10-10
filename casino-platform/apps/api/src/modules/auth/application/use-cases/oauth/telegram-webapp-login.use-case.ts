import { createHmac, timingSafeEqual } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  OAuthUserProvisioningService,
  type OAuthSignInResult,
} from '@modules/auth/application/use-cases/oauth/oauth-user-provisioning.service'
import { telegramDisplayName } from '@modules/auth/application/use-cases/oauth/telegram-login.use-case'
import { OAuthExchangeError, OAuthNotConfiguredError } from '@modules/auth/domain/errors'

/**
 * Окно жизни подписи — 15 минут, а не сутки как у Login Widget. Причина не в
 * Telegram, а в том, что вход здесь молчаливый: у виджета есть экран
 * «Продолжить как …», где игрок видит, под каким аккаунтом он заходит, а здесь
 * сессия выдаётся без касания. `init_data` при этом пересылается как есть, и
 * любой, кто подсунул её чужому браузеру (ссылка с параметром, перехват), получает
 * вход в чужой аккаунт — поэтому срок, в течение который подпись остаётся
 * годной, сокращён до реального времени запуска приложения.
 */
const MAX_AUTH_AGE_SEC = 900
/** Часы клиента могут спешить; больше минуты — это уже подозрительный auth_date. */
const MAX_FUTURE_SKEW_SEC = 60
/** id аккаунта Telegram: положительное число без ведущего нуля, в пределах int64. */
const TELEGRAM_ID_RE = /^[1-9][0-9]{0,18}$/
const HASH_SECRET_LABEL = 'WebAppData' // константа Telegram для Mini App

/** Профиль игрока из `user` внутри initData. */
export interface TelegramWebAppUser {
  /** Нормализованный id аккаунта Telegram — десятичная строка без ведущего нуля. */
  id: string
  first_name?: string | undefined
  last_name?: string | undefined
  username?: string | undefined
}

export interface TelegramWebAppSignInInput {
  /** Сырая строка `window.Telegram.WebApp.initData` — как её подписал Telegram. */
  initData: string
  referralCode?: string | undefined
}

/**
 * Разбор `init_data` на поля. Значение декодируется РОВНО ОДИН раз: Telegram
 * подписывает значения после unquote, и второе декодирование (или JSON.parse →
 * JSON.stringify вложенного `user`) меняет байты check-строки — подпись
 * расходится на живом клиенте, где в имени есть пробел, `&` или кириллица.
 */
export function parseInitDataFields(rawInitData: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const pair of rawInitData.split('&')) {
    if (pair === '') {
      continue
    }
    const separator = pair.indexOf('=')
    if (separator < 1) {
      continue
    }
    const key = pair.slice(0, separator)
    let value: string
    try {
      value = decodeURIComponent(pair.slice(separator + 1))
    } catch {
      throw new OAuthExchangeError('init_data невозможно разобрать')
    }
    fields[key] = value
  }
  return fields
}

/**
 * data-check-string: полученные поля без `hash` и `signature`, отсортированные
 * по ключу, в виде `key=value` через `\n`.
 */
export function buildInitDataCheckString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== 'hash' && key !== 'signature')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n')
}

/**
 * id аккаунта Telegram из разобранного `user`. Форма проверяется здесь, а не
 * «на доверии»: связка auth_providers(telegram, provider_user_id) уникальна по
 * СТРОКЕ, и «045367» или «45367 » создали бы второго беспарольного игрока с
 * отдельным кошельком и отдельной реферальной веткой на того же человека.
 */
function normalizeUserId(candidate: Record<string, unknown>): string {
  const rawId = candidate['id']
  const providerUserId = typeof rawId === 'number' ? String(rawId) : rawId
  if (typeof providerUserId !== 'string' || !TELEGRAM_ID_RE.test(providerUserId)) {
    throw new OAuthExchangeError('id пользователя в init_data некорректен')
  }
  return providerUserId
}

/** `user` из initData: JSON лежит строкой внутри подписанных полей. */
function readInitDataUser(fields: Record<string, string>): TelegramWebAppUser {
  const rawUser = fields['user']
  if (rawUser === undefined) {
    throw new OAuthExchangeError('в init_data нет пользователя')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawUser) as unknown
  } catch {
    throw new OAuthExchangeError('user в init_data не является JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new OAuthExchangeError('user в init_data не объект')
  }
  const candidate = parsed as Record<string, unknown>
  return {
    id: normalizeUserId(candidate),
    first_name: typeof candidate['first_name'] === 'string' ? candidate['first_name'] : undefined,
    last_name: typeof candidate['last_name'] === 'string' ? candidate['last_name'] : undefined,
    username: typeof candidate['username'] === 'string' ? candidate['username'] : undefined,
  }
}

/**
 * Telegram Mini App (TZ ч.2 §Telegram, GAP-75): игрок открывает сайт внутри
 * клиента Telegram и получает сессию по подписанному `initData` — без
 * редиректа на oauth.telegram.org и без вопроса про номер телефона.
 *
 * Отличия от Login Widget, которые нельзя терять:
 * - секрет подписи — `HMAC-SHA256(key="WebAppData", msg=botToken)`, а НЕ
 *   `SHA256(botToken)` как у виджета; смешивать эти два вывода нельзя, это
 *   разные протоколы одного и того же токена;
 * - в check-строку идут СЫРЫЕ значения из query-строки `init_data`, поэтому
 *   сервер разбирает её сам и никогда не принимает набор полей от клиента.
 *
 * Данные `initData` проверяются до любого обращения к БД: Telegram прямо
 * предупреждает, что непроверенным им доверять нельзя.
 */
@Injectable()
export class TelegramWebAppLoginUseCase {
  constructor(
    @Inject(ConfigService) private config: ConfigService,
    @Inject(OAuthUserProvisioningService) private provisioning: OAuthUserProvisioningService,
  ) {}

  private verify(fields: Record<string, string>): void {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN')
    if (!botToken) {
      throw new OAuthNotConfiguredError('Telegram')
    }

    const hash = fields['hash']
    if (hash === undefined || hash === '') {
      throw new OAuthExchangeError('в init_data нет подписи')
    }

    const dataCheckString = buildInitDataCheckString(fields)
    const secretKey = createHmac('sha256', HASH_SECRET_LABEL).update(botToken).digest()
    const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

    const received = Buffer.from(hash, 'hex')
    const computed = Buffer.from(expected, 'hex')
    if (received.length !== computed.length || !timingSafeEqual(received, computed)) {
      throw new OAuthExchangeError('подпись Telegram не совпадает')
    }

    const authDate = Number(fields['auth_date'])
    const nowSec = Math.floor(Date.now() / 1000)
    if (
      !Number.isFinite(authDate) ||
      nowSec - authDate > MAX_AUTH_AGE_SEC ||
      authDate - nowSec > MAX_FUTURE_SKEW_SEC
    ) {
      throw new OAuthExchangeError('данные Mini App просрочены')
    }
  }

  async execute(
    input: TelegramWebAppSignInInput,
    meta?: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<OAuthSignInResult> {
    const fields = parseInitDataFields(input.initData)
    this.verify(fields)
    const user = readInitDataUser(fields)

    /**
     * Регистрация — НЕ молчаливая. `init_data` — предъявительский токен: кто его
     * получил, тот и входит, и подпись не отличает «клиент запустил приложение»
     * от «игроку прислали ссылку с чужой подписью». Для входа в существующий
     * аккаунт это приемлемый риск (окно подписи — 15 минут), для СОЗДАНИЯ
     * беспарольного аккаунта с кошельком — нет: жертва ссылки молча получила бы
     * чужой профиль и потом пополняла его. Новый игрок проходит через экран
     * подтверждения виджета, где видно имя аккаунта («Продолжить как …»).
     */
    if (!(await this.provisioning.hasAccount('telegram', user.id))) {
      throw new OAuthExchangeError(
        'этот Telegram ещё не зарегистрирован — подтвердите создание аккаунта на сайте',
      )
    }

    return this.provisioning.signIn({
      provider: 'telegram',
      providerUserId: user.id,
      displayName: telegramDisplayName(user) ?? undefined,
      referralCode: input.referralCode,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    })
  }
}
