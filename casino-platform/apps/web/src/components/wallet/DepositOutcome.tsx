'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Итог оплаты, которым платёжная система возвращает игрока в кошелёк:
 * `?deposit=success` / `?deposit=failed` (см. RUKASSA_SUCCESS_URL / _FAIL_URL и
 * docs/ENVIRONMENT_VARIABLES.md §«Ссылки возврата»).
 *
 * Почему это отдельный компонент, а не строчка в странице: `useSearchParams`
 * на статически рендерящемся роуте требует Suspense-границы, и держать её надо
 * вокруг потребителя, а не вокруг всей страницы кошелька.
 */
type Outcome = 'success' | 'failed'

function parseOutcome(raw: string | null): Outcome | null {
  return raw === 'success' || raw === 'failed' ? raw : null
}

export function DepositOutcome({ onRetry }: { onRetry: () => void }): React.JSX.Element | null {
  const params = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const fromUrl = parseOutcome(params.get('deposit'))
  // Баннер живёт в state, а не в URL: чистка адреса ниже на следующем рендере
  // убрала бы сообщение, и игрок увидел бы его только на долю секунды.
  const [shown, setShown] = useState<Outcome | null>(fromUrl)

  useEffect(() => {
    if (!fromUrl) {
      return
    }
    setShown(fromUrl)
    // Зачисление идёт вебхуком, а не этим редиректом: баланс мог ещё не успеть
    // измениться, поэтому сразу тревожим запросы, не дожидаясь интервала.
    void queryClient.invalidateQueries({ queryKey: ['wallet'] })
    void router.replace('/wallet', { scroll: false })
  }, [fromUrl, queryClient, router])

  if (!shown) {
    return null
  }

  if (shown === 'success') {
    return (
      <div
        role="status"
        className="mb-4 rounded-xl border border-money/40 bg-money/10 px-4 py-3 text-sm text-money"
      >
        Оплата прошла. Баланс обновится, как только платёжная система пришлёт подтверждение — обычно
        это несколько секунд.
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#FF3D71]/30 bg-[#FF3D71]/5 px-4 py-3 text-sm"
    >
      Платёж не завершён. Если деньги всё равно списались — напишите в поддержку.
      <button type="button" className="btn-ghost shrink-0 px-3 py-1 text-xs" onClick={onRetry}>
        Повторить
      </button>
    </div>
  )
}
