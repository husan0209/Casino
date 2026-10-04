import { LegalPage } from '@/components/layout/LegalPage'
import { COOKIES_VERSION, cookiesSections } from '@/content/legal/cookies'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  // absolute — см. комментарий в ../terms/page.tsx: бренд не входит в правовой документ.
  title: { absolute: 'Политика cookie' },
  openGraph: { title: 'Политика cookie' },
}

export default function CookiesPage(): React.JSX.Element {
  return (
    <LegalPage
      title="Политика cookie"
      updated={`2026-10-03 · версия ${COOKIES_VERSION}`}
      intro="Какие cookie и локальные хранилища использует Сервис, зачем они нужны и как их отключить. Рекламных и аналитических трекеров нет — страница это подтверждает, а не обещает."
      sections={cookiesSections}
    />
  )
}
