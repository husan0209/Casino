'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * GAP-55 (ж) (ТЗ §5.2): виджет Cloudflare Turnstile.
 *
 * Возникает ТОЛЬКО когда бэк ответил CAPTCHA_REQUIRED — до пяти неудач форма
 * остаётся короткой (§5.1 «формы короткие»). Без публичного ключа не рендерится
 * вообще: в непронастроенном окружении вход не должен требовать того, чего нет.
 *
 * SDK не ставим зависимостью — скрипт грузится по запросу (он и так внешний,
 * CSP `script-src … https:` его разрешает), типы описаны локально.
 */
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const SITE_KEY = process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY'] ?? ''

interface TurnstileApi {
  render: (element: HTMLElement, options: {
    sitekey: string
    callback: (token: string) => void
    'expired-callback'?: () => void
    theme?: string
  }) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve()
  }
  if (window.turnstile) {
    return Promise.resolve()
  }
  const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => resolve())
    })
  }
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => resolve())
    document.head.appendChild(script)
  })
}

export function CaptchaField({
  onToken,
}: {
  onToken: (token: string) => void
}): React.JSX.Element | null {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (SITE_KEY.length === 0) {
      return
    }
    let widgetId: string | undefined
    let cancelled = false

    const mount = async (): Promise<void> => {
      await loadScript()
      if (cancelled) {
        return
      }
      if (!window.turnstile || !holderRef.current) {
        setFailed(true) // скрипт не дошёл (блокировка сети/AdGuard) — говорим об этом прямо
        return
      }
      widgetId = window.turnstile.render(holderRef.current, {
        sitekey: SITE_KEY,
        theme: 'dark',
        callback: onToken,
        'expired-callback': () => onToken(''),
      })
      setReady(true)
    }

    void mount()
    return () => {
      cancelled = true
      if (widgetId !== undefined && window.turnstile) {
        window.turnstile.remove(widgetId)
      }
    }
  }, [onToken])

  if (SITE_KEY.length === 0) {
    return null
  }

  return (
    <div className="space-y-1">
      <div ref={holderRef} aria-live="polite" />
      {failed && <p className="text-xs text-[#FF3D71]">Капча не загрузилась — попробуйте ещё раз</p>}
      {!ready && SITE_KEY.length > 0 && (
        <p className="text-xs text-muted">Загружаем подтверждение…</p>
      )}
    </div>
  )
}
