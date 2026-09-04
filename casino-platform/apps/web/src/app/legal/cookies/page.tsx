import type { Metadata } from 'next'

import { LegalPage } from '@/components/layout/LegalPage'

export const metadata: Metadata = {
  title: 'Политика cookie — Casino',
}

/**
 * Политика cookie (GAP-49, ТЗ ч.7 §15.6).
 * Фактически используемые cookie — по коду: refresh_token (httpOnly, сессия),
      x-request-id (технический). Аналитики в коде нет.
 */
export default function CookiesPage(): React.JSX.Element {
  return (
    <LegalPage
      title="Политика cookie"
      updated="2026-09-03"
      intro="Какие cookie использует сайт и зачем."
      sections={[
        {
          heading: 'Сессия (обязательные)',
          body: (
            <p>
              <code className="text-white">refresh_token</code> — httpOnly-cookie для
              автоматического продления входа. Без неё придётся логиниться заново. Удаляется при
              выходе.
            </p>
          ),
        },
        {
          heading: 'Технические',
          body: (
            <p>
              <code className="text-white">x-request-id</code> — идентификатор запроса для
              отладки (если вы передаёте свой, сервер валидирует его по белому списку).
            </p>
          ),
        },
        {
          heading: 'Аналитика и реклама',
          body: <p>Трекинговых и рекламных cookie на сайте нет.</p>,
        },
      ]}
    />
  )
}
