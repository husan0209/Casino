'use client'

import { detectTelegramWebApp } from '@/lib/telegram-webapp'

/** Полный переход документа — то, что нужно WebView: игра стартует заново. */
function navigateWholeDocument(href: string): void {
  window.location.href = href
}

/**
 * Адрес игры внутри нашего приложения: тот же маршрут, что использует запуск на
 * реальные деньги, поэтому шапка с балансом и кнопка кассы остаются живыми.
 */
export function demoGameHref(slug: string, launchUrl: string): string {
  return `/casino/${slug}/play?url=${encodeURIComponent(launchUrl)}`
}

/**
 * Открытие демо-игры (ТЗ ч.5 §7, GAP-21).
 *
 * В обычном браузере демо уходит в новую вкладку — так было всегда. В Telegram
 * Mini App вкладок нет: `window.open` либо молча возвращает `null`, либо клиент
 * выбрасывает игрока из приложения в системный браузер. Поэтому внутри Telegram
 * игра едет в ЭТОМ же документе на `/play`.
 *
 * `noopener` держим на обоих путях: страница провайдера не получает доступ к
 * `window.opener` нашего кассового экрана.
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
  if (detectTelegramWebApp()) {
    navigate(demoGameHref(slug, launchUrl))
    return
  }
  window.open(launchUrl, '_blank', 'noopener')
}
