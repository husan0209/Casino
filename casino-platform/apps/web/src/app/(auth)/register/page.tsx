'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useUIStore } from '@/stores/ui'

/**
 * §5: отдельной страницы регистрации больше нет — регистрация живёт в LoginSheet
 * на любом экране. /register остаётся только для старых ссылок (реклама, /go):
 * открываем лист в режиме регистрации и возвращаемся на исходный экран
 * (?ref= сохраняется — лист подставит код тихо).
 */
export default function RegisterPage(): React.JSX.Element {
  const openLogin = useUIStore((s) => s.openLogin)
  const router = useRouter()

  useEffect(() => {
    openLogin(undefined, 'register')
    router.replace(`/${window.location.search}`)
  }, [openLogin, router])

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <p className="text-sm text-muted">Открываем форму регистрации…</p>
    </div>
  )
}
