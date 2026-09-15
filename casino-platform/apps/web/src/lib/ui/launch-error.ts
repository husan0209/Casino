/**
 * GAP-55 (в) (ТЗ ч.5 §8.4): ошибки запуска игры — отдельные экраны, не общий
 * toast. §2.3.9: «ошибка даёт следующий шаг, не тупик» — поэтому у каждого
 * состояния есть набор действий (retry/deposit/смена валюты/каталог/поддержка).
 *
 * Маппинг по стабильным кодам ошибок API (apps/api/src/modules/casino/domain/
 * errors.ts, wallet: INSUFFICIENT_FUNDS) + фолбэк на таймаут/5xx/сеть.
 */

export type LaunchErrorAction = 'retry' | 'deposit' | 'switch_currency' | 'catalog' | 'support'

export interface LaunchErrorView {
  title: string
  text: string
  actions: LaunchErrorAction[]
}

export interface LaunchErrorInput {
  code?: string | undefined
  status?: number | undefined
  /** true — ответ не пришёл вообще (timeout/DNS/CORS), axios не имеет response. */
  network?: boolean | undefined
}

const SCREENS: Record<string, LaunchErrorView> = {
  GAME_NOT_FOUND: {
    title: 'Игра не найдена',
    text: 'Такой игры нет в каталоге или её сняли с публикации.',
    actions: ['catalog', 'support'],
  },
  GAME_DISABLED: {
    title: 'Игра недоступна',
    text: 'Игра отключена или недоступна в вашем регионе.',
    actions: ['catalog', 'support'],
  },
  PROVIDER_MAINTENANCE: {
    title: 'Техработы у провайдера',
    text: 'Провайдер игры сейчас на работах. Попробуйте позже или выберите другую игру.',
    actions: ['retry', 'catalog', 'support'],
  },
  PROVIDER_NOT_SUPPORTED: {
    title: 'Игра не запускается',
    text: 'Провайдер не поддерживает запуск этой игры. Мы уже чиним.',
    actions: ['catalog', 'support'],
  },
  GAME_SESSION_INVALID: {
    title: 'Игра уже открыта',
    text: 'Эта сессия запущена в другом окне. Закройте её и попробуйте снова.',
    actions: ['retry', 'support'],
  },
  CURRENCY_NOT_SUPPORTED: {
    title: 'Валюта не поддерживается',
    text: 'Этот провайдер не принимает активный кошелёк. Конвертации не будет — выберите кошелёк, который игра умеет.',
    actions: ['switch_currency', 'deposit', 'catalog'],
  },
  INSUFFICIENT_FUNDS: {
    title: 'Недостаточно средств',
    text: 'На активном кошельке не хватает денег для ставки. Пополните его или играйте с другого кошелька.',
    actions: ['deposit', 'switch_currency', 'catalog'],
  },
  WALLET_NOT_FOUND: {
    title: 'Кошелёк не готов',
    text: 'Для этой валюты ещё нет кошелька. Пополните — он создастся автоматически.',
    actions: ['deposit', 'switch_currency', 'catalog'],
  },
}

const TIMEOUT: LaunchErrorView = {
  title: 'Провайдер не ответил',
  text: 'Игра не запустилась вовремя. Проверьте связь и попробуйте ещё раз.',
  actions: ['retry', 'catalog', 'support'],
}

const UNKNOWN: LaunchErrorView = {
  title: 'Не удалось запустить игру',
  text: 'Что-то пошло не так. Попробуйте ещё раз — если повторится, напишите в поддержку.',
  actions: ['retry', 'catalog', 'support'],
}

export function describeLaunchError(input: LaunchErrorInput): LaunchErrorView {
  if (input.code !== undefined && Object.prototype.hasOwnProperty.call(SCREENS, input.code)) {
    return SCREENS[input.code] as LaunchErrorView
  }
  // Сеть/таймаут или 5xx провайдера — «провайдер не ответил» (§8.4)
  if (input.network === true || (input.status !== undefined && input.status >= 500)) {
    return TIMEOUT
  }
  return UNKNOWN
}

/** Надпись кнопки — чтобы экран и обработчик брали текст из одного места. */
export const LAUNCH_ACTION_LABELS: Record<LaunchErrorAction, string> = {
  retry: 'Попробовать снова',
  deposit: 'Пополнить',
  switch_currency: 'Выбрать другой кошелёк',
  catalog: 'В каталог',
  support: 'Написать в поддержку',
}
