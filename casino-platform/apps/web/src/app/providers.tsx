'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { errStatus } from '@/lib/api'
import { setupApiInterceptors } from '@/lib/api-interceptors'
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
  useEffect(() => {
    void useAuthStore.getState().hydrate()
  }, [])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
