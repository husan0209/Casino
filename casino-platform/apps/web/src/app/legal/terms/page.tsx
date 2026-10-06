import { LegalPage } from '@/components/layout/LegalPage'
import { TERMS_KEY_POINTS, TERMS_VERSION, termsSections } from '@/content/legal/terms'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  // absolute — чтобы глобальный шаблон '%s | Casino' не подставлял бренд в заголовок
  // правового документа: в самом документе данных об операторе быть не должно (GAP-49).
  title: { absolute: 'Условия использования' },
  openGraph: { title: 'Условия использования' },
}

/**
 * Условия использования (ТЗ ч.7 §15.6). Канонический текст —
 * src/content/legal/terms.tsx; реквизиты оператора и лицензии там — плейсхолдеры
 * из реестра docs/LEGAL_COMPLIANCE.md §2, их заполняет владелец с юристом.
 */
export default function TermsOfServicePage(): React.JSX.Element {
  return (
    <LegalPage
      title="Условия использования"
      updated={`2026-10-03 · версия ${TERMS_VERSION}`}
      intro="Документ описывает, как устроены игра, выплаты, верификация и бонусы, что может быть аннулировано и как разрешается спор. Полные тексты доступны до регистрации и в один клик от любой страницы."
      keyPoints={TERMS_KEY_POINTS}
      sections={termsSections}
    />
  )
}
