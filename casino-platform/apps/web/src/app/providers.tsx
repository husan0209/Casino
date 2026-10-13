'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { errStatus } from '@/lib/api'
import { setupApiInterceptors } from '@/lib/api-interceptors'
import { startGoogleOneTap } from '@/lib/google-one-tap'
import { handshakeTelegramWebApp } from '@/lib/telegram-webapp-auth'
import { useAuthStore } from '@/stores/auth'

export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              const status = errStatus(error)
              // 429 — ретрай долбит лимит ровно в момент, когда он исчерпан (усиливал
              // 429-шторм на проде); 401/403 — повтор бессмысленен: silent refresh уже
              // отработал в axios-интерцепторе, повторный вызов упадёт так же.
              if (status === 429 || status === 401 || status === 403) {
                return false
              }
              return failureCount < 1
            },
          },
        },
      }),
  )

  // axios-interceptors (auth-token + silent refresh): подключаем один раз
  // (модуль отдельный, чтобы не было цикла lib/api <-> stores/auth)
  useEffect(() => {
    setupApiInterceptors()
  }, [])

  // P1 #11: восстановление сессии после reload — access-token только в памяти,
  // новый получаем по httpOnly-cookie; user подтягиваем из /users/me
  //
  // Mini App (GAP-21): если страница открыта внутри Telegram, сначала пробуем
  // silent-вход по подписанному initData. Cookie в WebView переживает не каждый
  // перезапуск приложения, а подпись Telegram доступна всегда — игрок уже в чате
  // с ботом. Провал (не Telegram, отказ сервера) = обычная гидрация, то есть
  // привычный экран входа: путь Telegram ничего не ломает в браузере.
  useEffect((): void => {
    void handshakeTelegramWebApp()
      .then(async (signedIn): Promise<void> => {
        if (!signedIn) {
          await useAuthStore.getState().hydrate()
        }
        // One Tap — после гидрации и только гостю: игроку с рабочей сессией
        // подсказка «войти ещё и через Google» не нужна, а гостю она даёт вход в
        // один тап. Любая неудача (нет сессии Google, скрипт не доехал, сервер
        // отказал) молча оставляет обычный экран входа.
        if (await startGoogleOneTap()) {
          toast.success('Вы вошли через Google')
        }
      })
      .catch((): void => {
        // Исключение здесь не показываем тостом: путь Google — дополнительный.
      })
    // Только при монтировании: повторный запуск дал бы второй запрос nonce и
    // вторую попытку подсказки на той же странице.
  }, [])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
