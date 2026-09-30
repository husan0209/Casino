'use client'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { affiliateGet } from '@/lib/affiliate-api'
import { formatRate } from '@/lib/affiliate-format'
import { type AffiliateLinksDto, type AffiliateMeDto } from '@/types/affiliate'

/** Deep-link на конкретную игру. Плейсхолдер — партнёр подставит свой slug. */
function LinkRow({
  label,
  url,
  hint,
}: {
  label: string
  url: string
  hint?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Скопировано')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard недоступен без https или без разрешения — не молчим.
      toast.error('Не удалось скопировать. Выделите ссылку вручную.')
    }
  }

  return (
    <div className="py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div>
          <div className="text-sm font-semibold">{label}</div>
          {hint !== undefined && <div className="text-muted text-xs">{hint}</div>}
        </div>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="input font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button onClick={() => void copy()} className="btn-ghost text-sm shrink-0">
          {copied ? 'Готово' : 'Копировать'}
        </button>
      </div>
    </div>
  )
}

function LinksContent(): React.JSX.Element {
  const searchParams = useSearchParams()
  const justCreated = searchParams.get('created')

  const me = useQuery({
    queryKey: ['aff-me'],
    queryFn: () => affiliateGet<AffiliateMeDto>('/affiliate/me'),
  })
  const links = useQuery({
    queryKey: ['aff-links'],
    queryFn: () => affiliateGet<AffiliateLinksDto>('/affiliate/links'),
  })

  const base = me.data?.tracking_url ?? links.data?.tracking_url ?? ''

  return (
    <div>
      {justCreated !== null && (
        <div className="card mb-4 border-[#00C853]/40">
          <div className="font-semibold text-[#00C853] text-sm">Партнёрский аккаунт создан</div>
          <div className="text-muted text-sm mt-1">
            Ваш код: <span className="font-mono text-white">{justCreated}</span>. Ссылка уже активна
            — начинайте приводить игроков.
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="text-muted text-sm mb-1">Ваш код партнёра</div>
        <div className="text-2xl font-black font-mono text-brand">
          {me.data?.tracking_code ?? '…'}
        </div>
        <div className="text-muted text-xs mt-2">
          Ставка RevShare:{' '}
          <b className="text-[#00C853]">{me.data ? formatRate(me.data.revshare_rate) : '…'}</b> ·
          атрибуция действует {links.data?.cookie_days ?? '…'} дней с клика
        </div>
      </div>

      <div className="card mb-4">
        <div className="font-semibold mb-1">Ссылки для продвижения</div>
        <div className="text-muted text-xs mb-1">
          Deep-link ведёт на конкретную страницу казино. Параметры: <code>p</code> — путь,
          <code> c</code> — кампания, <code> s</code> — sub-id (для своей аналитики).
        </div>
        {base === '' ? (
          <div className="text-muted text-sm py-4">Загрузка…</div>
        ) : (
          <>
            <LinkRow label="Основная ссылка" url={base} hint="На главную витрины" />
            {(links.data?.examples ?? []).map((example) => (
              <LinkRow key={example.name} label={example.name} url={example.url} />
            ))}
            <LinkRow
              label="Deep-link на игру"
              url={`${base}?p=/casino/ВАШ_SLUG_ИГРЫ`}
              hint="Подставьте slug игры вместо ВАШ_SLUG_ИГРЫ"
            />
            <LinkRow
              label="С кампанией"
              url={`${base}?p=/casino&c=МЕТКА_КАМПАНИИ`}
              hint="Позволяет отдельно считать кампании в статистике"
            />
          </>
        )}
      </div>

      <div className="card">
        <div className="font-semibold mb-1">Правила рекламы</div>
        <ul className="text-muted text-sm space-y-1.5 list-disc pl-5">
          <li>Материалы только для аудитории 18+. Запрещены обещания гарантированного выигрыша.</li>
          <li>Запрещена контекстная реклама по бренду казино (бренд-биддинг).</li>
          <li>Нельзя предлагать игрокам кэшбэк или бонусы из комиссии партнёра.</li>
          <li>Нельзя привлекать самоисключённых игроков — такие начисления отменяются.</li>
          <li>Нельзя использовать фальшивые отзывы, вымышленные «выигрыши» и дипфейки.</li>
        </ul>
        <div className="text-muted text-xs mt-3">
          Нарушение правил ведёт к блокировке партнёрского аккаунта. Начисленные до блокировки
          средства не отзываются, но новые начисления прекращаются.
        </div>
      </div>
    </div>
  )
}

export default function AffiliateLinksPage(): React.JSX.Element {
  // useSearchParams требует Suspense в Next 14 при статической генерации.
  return (
    <Suspense fallback={<div className="text-muted text-sm py-6">Загрузка…</div>}>
      <LinksContent />
    </Suspense>
  )
}
