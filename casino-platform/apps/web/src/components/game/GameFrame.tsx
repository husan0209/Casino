'use client'

import { useEffect, useState } from 'react'

import { detectTelegramWebApp } from '@/lib/telegram-webapp'

/**
 * GAP-55 (е) (ТЗ §22): игровой iframe вынесен в отдельный чанк — play-страница
 * грузит его через `dynamic(..., { ssr:false })`, чтобы шапка с балансом и
 * кнопкой кассы появлялись сразу, а тяжёлый фрейм провайдера подтягивался после
 * (§22: «dynamic import iframe», «не тащить игровые библиотеки в общий bundle»).
 * Размонтируется вместе с роутом: держать iframe в памяти после выхода из игры
 * запрещено §8.4.
 */

/** Через сколько секунд считаем, что провайдер не ответил вовсе. */
const STALL_TIMEOUT_MS = 12_000

/**
 * Разрешения для игрового содержимого. `fullscreen` был единственный, и этого
 * мало: слоты просят автоплей и звук (autoplay/encrypted-media), а мобильные
 * столы — датчики (gyroscope/accelerometer). В WebView Telegram отказ по
 * разрешению выглядит как «игра молчит», поэтому список полный.
 */
const GAME_PERMISSIONS = 'fullscreen; autoplay; encrypted-media; gyroscope; accelerometer'

export function GameFrame({ url }: { url: string }): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [stalled, setStalled] = useState(false)

  /**
   * Смена игры обязана сбрасывать оба флага: иначе заглушка переживает
   * перемонтирование, и вторая игра в сессии не открывается никогда.
   */
  useEffect((): void => {
    setLoaded(false)
    setStalled(false)
  }, [url])

  /**
   * Засечка ловит «фрейм не ответил вообще» — зависший провайдер, блокировка
   * сети клиента. Пустой кадр из-за X-Frame-Options браузер тоже считает
   * загруженным, так что против «белого экрана» эта засечка бессильна: её
   * задача — не выдать игроку вечную «Загрузку игры…».
   */
  useEffect((): (() => void) => {
    if (loaded) {
      return (): void => undefined
    }
    const timer = window.setTimeout((): void => {
      setStalled(true)
    }, STALL_TIMEOUT_MS)
    return (): void => {
      window.clearTimeout(timer)
    }
  }, [loaded, url])

  const openOutsideFrame = (): void => {
    // Внутри Telegram новой вкладки нет (см. lib/open-game.ts): уводим игру в
    // этот же документ, иначе кнопка выбросила бы игрока из приложения.
    if (detectTelegramWebApp()) {
      window.location.href = url
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  if (stalled) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted">
          Игра не открылась. Провайдер мог запретить встраивание в чужое окно — попробуй открыть её
          отдельно.
        </p>
        <button type="button" className="btn px-4 py-2 text-sm" onClick={openOutsideFrame}>
          Открыть игру
        </button>
      </div>
    )
  }

  return (
    <iframe
      src={url}
      title="Игровой экран"
      className="w-full flex-1 border-0"
      allow={GAME_PERMISSIONS}
      onLoad={(): void => {
        setLoaded(true)
      }}
    />
  )
}
