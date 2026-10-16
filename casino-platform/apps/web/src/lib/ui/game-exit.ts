'use client'

/**
 * Куда уходит игрок из игры на `/casino/<slug>/play`.
 *
 * «Назад» честнее главной: игрок возвращается к той самой колоде, из которой
 * кликнул, а не теряет её. Но историю нельзя трогать, если на `/play` попали
 * напрямую — ссылкой из чата или «открыть во вкладке»: там `back()` выбросил бы
 * человека с нашего сайта, и выход превратился бы в потерю. Признак «пришёл с
 * нашего» — referrer того же происхождения: он сохраняется при обычном
 * переходе `window.location.href` между своими страницами (так и открываются
 * игры, см. `lib/open-game.ts`).
 *
 * Отдельно: `/play` — единственный выход для клиентов, которые сами его не
 * рисуют (Plinko, донорские слоты). До переезда на маршрут демо уходило
 * `window.open`, и в свежей вкладке кнопки «назад» не было вовсе.
 */
export interface LeaveGameDeps {
  readonly referrer: string
  readonly origin: string
  readonly historyLength: number
  readonly back: () => void
  readonly home: () => void
}

export function leaveGame(deps: LeaveGameDeps): 'back' | 'home' {
  if (isSameOriginReferrer(deps.referrer, deps.origin) && deps.historyLength > 1) {
    deps.back()
    return 'back'
  }
  deps.home()
  return 'home'
}

function isSameOriginReferrer(referrer: string, origin: string): boolean {
  if (!referrer) {
    return false
  }
  try {
    return new URL(referrer).origin === origin
  } catch {
    return false
  }
}

/**
 * Просьба игрового фрейма закрыться (ТЗ и `docs/PROVIDER_INTEGRATION_STRATEGY.md`
 * §6.1, шаг 3: «Listen for events from iframe»).
 *
 * Источник проверяется обязательно: без этого любой фрейм внутри страницы
 * мог бы заставить хост куда-то уйти. Пока в игру встроены только наши
 * собственные клиенты — они на том же происхождении; когда подключим
 * агрегатора, сюда же добавляется его белый список.
 */
export function isCloseRequest(event: MessageEvent, origin: string): boolean {
  if (event.origin !== origin) {
    return false
  }
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const message = data as { source?: unknown; type?: unknown }
  return message.source === 'casino' && message.type === 'close'
}
