'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { setupApiInterceptors } from '@/lib/api-interceptors'

export default function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }))

  // axios-interceptors (auth-token + logout на 401): подключаем один раз
  // (модуль отдельный, чтобы не было цикла lib/api <-> stores/auth)
  useEffect(() => {
    setupApiInterceptors()
  }, [])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
