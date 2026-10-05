import { LegalPage } from '@/components/layout/LegalPage'
import { PRIVACY_VERSION, privacySections } from '@/content/legal/privacy'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  // absolute — см. комментарий в ../terms/page.tsx: бренд не входит в правовой документ.
  title: { absolute: 'Политика конфиденциальности' },
  openGraph: { title: 'Политика конфиденциальности' },
}

export default function PrivacyPage(): React.JSX.Element {
  return (
    <LegalPage
      title="Политика конфиденциальности"
      updated={`2026-10-03 · версия ${PRIVACY_VERSION}`}
      intro="Что именно собирает Сервис, на каком основании, сколько хранит, кому передаёт и как потребовать копию или удаление. Перечень данных соответствует фактической модели данных."
      sections={privacySections}
    />
  )
}
