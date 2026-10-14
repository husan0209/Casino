'use client'

/** Полный переход документа — то, что нужно WebView: игра стартует заново. */
function navigateWholeDocument(href: string): void {
  window.location.href = href
}

/**
 * Адрес игры внутри нашего приложения: тот же маршрут, что использует запуск на
 * реальные деньги, поэтому планка с выходом и балансом остаётся живой.
 */
export function demoGameHref(slug: string, launchUrl: string): string {
  return `/casino/${slug}/play?url=${encodeURIComponent(launchUrl)}`
}

/**
 * Открытие демо-игры (ТЗ ч.5 §7, GAP-21).
 *
 * Всегда в ЭТОМ же документе на `/casino/<slug>/play` — тот же маршрут, по
 * которому едет игра на реальные деньги. Раньше в обычном браузере демо уходило
 * `window.open('_blank')`, и это ломало две вещи: игрок выпадал из казино (нет
 * шапки, нет баланса, лобби остаётся «висеть» в другой вкладке), а из голого
 * клиента игры вроде Plinko выбраться было нечем — в свежей вкладке кнопки
 * «назад» нет, а сам клиент её не рисует. В Telegram Mini App вкладок не
 * существует в принципе, поэтому там маршрут применялся и раньше.
 *
 * `navigate` — точка выхода в навигацию: по умолчанию полный переход документа,
 * вызывающий может отдать её своему роутеру. Специфике она нужна чтобы проверять
 * выбор пути, не трогая `window.location` (в jsdom он не переназначается).
 */
export function openDemoGame(
  slug: string,
  launchUrl: string,
  navigate: (href: string) => void = navigateWholeDocument,
): void {
  navigate(demoGameHref(slug, launchUrl))
}
