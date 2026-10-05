'use client'

import Link from 'next/link'
import { useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { errText } from '@/lib/api'
import { useAuth } from '@/stores/auth'

import { LEGAL_DOCUMENT_VERSIONS } from '@casino/shared-types'

/**
 * Диалог повторного акцепта (GAP-73, Terms §21).
 *
 * Появляется, когда сервер сказал `termsReacceptRequired`: с момента последнего
 * подтверждения игрока редакция Условий изменилась. Сигнал приходит не только от
 * `/auth/login` — store перечитывает его и для сессии из OAuth, подтверждения
 * письма и reload (Terms §21 говорит про вход, а не про способ входа). Отдельный
 * компонент, а не часть `LoginSheet`: листа регистрации в этих путях нет.
 *
 * Кнопка намеренно завязана на чекбокс: акцепт — активное действие (Terms §4),
 * поэтому «просто закрыл окно» согласием не считается. Закрыть без подтверждения
 * можно — диалог вернётся при следующем входе, а пока игрок не подтвердил,
 * договор действует в той редакции, которую он принимал.
 */
export function TermsReacceptDialog(): React.JSX.Element | null {
  const required = useAuth((state) => state.termsReacceptRequired)
  const acceptTerms = useAuth((state) => state.acceptTerms)
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)

  if (!required) {
    return null
  }

  const confirm = async (): Promise<void> => {
    setLoading(true)
    try {
      await acceptTerms()
      toast.success('Спасибо, подтверждение записано')
    } catch (error) {
      toast.error(errText(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="sheet-backdrop" aria-hidden />
      <div
        className="sheet-panel max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-reaccept-title"
      >
        <h2 id="terms-reaccept-title" className="mb-2 text-lg font-bold text-white">
          Условия использования обновились
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-muted">
          Действующая редакция — {LEGAL_DOCUMENT_VERSIONS.terms}. Прежде чем продолжить, прочитайте
          их и подтвердите согласие: без подтверждения договор остаётся в той версии, которую вы
          принимали ранее.
        </p>

        <ul className="mb-5 space-y-2 text-sm">
          <li>
            <Link
              href="/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white underline"
            >
              Условия использования
            </Link>
          </li>
          <li>
            <Link
              href="/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white underline"
            >
              Политика конфиденциальности
            </Link>
          </li>
          <li>
            <Link href="/legal/responsible-gaming" className="text-white underline">
              Ответственная игра
            </Link>
          </li>
        </ul>

        <label className="mb-5 flex items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            Мне 18+ лет, я прочитал новые условия и принимаю их, включая правила бонусов, выплат и
            разрешения споров.
          </span>
        </label>

        <button
          type="button"
          className="btn-money w-full"
          disabled={!consent || loading}
          onClick={() => {
            void confirm()
          }}
        >
          {loading ? 'Сохраняем…' : 'Принять условия'}
        </button>
      </div>
    </>
  )
}
