'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useUIStore } from '@/stores/ui'

/**
 * §5: отдельной страницы входа больше нет — вход живёт в LoginSheet на любом
 * экране. /login остаётся только для старых ссылок (письма, закладки):
 * открываем лист в режиме входа и возвращаемся на исходный экран
 * (?ref= и прочие параметры сохраняются — их читает лист).
 */
export default function LoginPage(): React.JSX.Element {
  const openLogin = useUIStore((s) => s.openLogin)
  const router = useRouter()

  useEffect(() => {
    openLogin(undefined, 'login')
    router.replace(`/${window.location.search}`)
  }, [openLogin, router])

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <p className="text-sm text-muted">Открываем форму входа…</p>
    </div>
  )
}
