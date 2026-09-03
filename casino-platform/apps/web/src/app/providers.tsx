'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useAuthStore } from '@/stores/auth'

export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  )

  // P1 #11: восстановление сессии после reload — access-token только в памяти,
  // новый получаем по httpOnly-cookie; user подтягиваем из /users/me
  useEffect(() => {
    void useAuthStore.getState().hydrate()
  }, [])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
