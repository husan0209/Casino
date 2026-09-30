'use client'

import { useQuery } from '@tanstack/react-query'
import { Heart, Play, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { GameThumb } from '@/components/casino/GameThumb'
import { useDemoLaunch } from '@/hooks/useDemoLaunch'
import { fetchGameDetails } from '@/lib/api/casino.api'
import { formatBalance } from '@/lib/format/currency'
import {
  gameDisplayName,
  gameHasDemo,
  gameMinBetLabel,
  gameRtpLabel,
  gameVolatilityLabel,
} from '@/lib/ui/game'
import { useAuth } from '@/stores/auth'
import { useUIStore, type GamePreviewOptions } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

/** Строка «RTP / Волатильность / Мин. ставка» (ТЗ ч.5 §8.1) — три колонки, одна рамка. */
function SpecTable({
  specs,
}: {
  specs: { label: string; value: string | null }[]
}): React.JSX.Element {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-[#2A2A4A]">
      <div className="grid grid-cols-3">
        {specs.map((spec) => (
          <div
            key={spec.label}
            className="border-b border-r border-[#2A2A4A] bg-white/[0.03] px-1 py-1.5 text-center text-[11px] text-muted last:border-r-0"
          >
            {spec.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3">
        {specs.map((spec) => (
          <div
            key={spec.label}
            className="border-r border-[#2A2A4A] px-1 py-2.5 text-center text-sm font-bold text-white last:border-r-0"
          >
            {spec.value ?? '—'}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Превью игры шторкой (ТЗ ч.5.1 §4.5, §4.7): «i» на карточке открывает этот
 * лист, а не инлайн-плашку поверх соседних карточек. Обложка — в край в край,
 * под ней провайдер, название, характеристики и обе кнопки запуска.
 */
export function GamePreviewSheet(): React.JSX.Element | null {
  const { gamePreview } = useUIStore()

  if (!gamePreview) {
    return null
  }
  return <GamePreviewBody options={gamePreview} />
}

function GamePreviewBody({ options }: { options: GamePreviewOptions }): React.JSX.Element {
  const { game, isFavorite, onToggleFavorite } = options
  const { user } = useAuth()
  const { closeGamePreview, openLogin } = useUIStore()
  const { activeCurrency, getActiveWallet } = useWalletStore()
  const router = useRouter()
  const { startDemo, isRunning: demoLoading } = useDemoLaunch()

  // Листинг каталога отдаёт только rtp/volatility: широкая обложка и мин. ставка
  // есть лишь в деталях (§8.1), поэтому шторка показывается сразу и дорисовывает
  // их, когда придёт ответ.
  const { data: details } = useQuery({
    queryKey: ['game', game.slug],
    queryFn: () => fetchGameDetails(game.slug),
    staleTime: 5 * 60_000,
  })

  const displayName = gameDisplayName(game)
  const provider = game.provider?.name ?? ''
  // Баланс показываем от активного кошелька — валюта того же кошелька, а не
  // фиатный `config.activeCurrency` (иначе USDT подписывались ₽).
  const currency = getActiveWallet()?.currency ?? activeCurrency
  const hasDemo = gameHasDemo(game.hasDemo)
  const balance = getActiveWallet()?.available ?? '0'

  const play = (): void => {
    closeGamePreview()
    if (!user) {
      // §8.2: гостя не разворачиваем — LoginSheet с продолжением launch.
      openLogin(game.slug)
      return
    }
    router.push(`/casino/${game.slug}?launch=1`)
  }

  return (
    <>
      {/* Фон за шторкой размыт: донор оставляет витрину читаемой как подложку,
          без blur каталог за листом перетягивает взгляд на себя. */}
      <div className="sheet-backdrop backdrop-blur-sm" onClick={closeGamePreview} />
      <div className="sheet-panel p-0" role="dialog" aria-label={displayName}>
        <div className="relative aspect-[5/3] w-full overflow-hidden">
          <GameThumb
            src={details?.bannerUrl ?? game.thumbnailUrl}
            alt={displayName}
            sizes="100vw"
          />
          {/* Затемнение к нижнему краю: светлые каверы иначе съедают кнопки ✕ и ♥ */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-[#1A1A2E]" />

          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(game)}
              aria-label={isFavorite ? 'Убрать из избранного' : 'В избранное'}
              className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/80"
            >
              <Heart
                size={16}
                aria-hidden
                className={isFavorite ? 'fill-[#FF3D71] text-[#FF3D71]' : ''}
              />
            </button>
          )}

          <button
            type="button"
            onClick={closeGamePreview}
            aria-label="Закрыть"
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/80"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="px-5 pb-8">
          {provider && (
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
              {provider}
            </p>
          )}
          <h2 className="mt-1 text-center text-2xl font-semibold tracking-tight text-white">
            {displayName}
          </h2>

          <SpecTable
            specs={[
              { label: 'RTP', value: gameRtpLabel(game.rtp) },
              { label: 'Волатильность', value: gameVolatilityLabel(game.volatility) },
              { label: 'Мин. ставка', value: gameMinBetLabel(details?.minBet, currency) },
            ]}
          />

          <button
            type="button"
            onClick={play}
            className="btn mt-5 w-full bg-gradient-to-r from-brand to-brand-light py-3.5 text-base font-bold"
          >
            {/* Треугольник запуска — только когда кнопка реально запускает игру. */}
            {user && <Play size={18} className="fill-current" aria-hidden />}
            {user ? 'Играть на деньги' : 'Войти, чтобы играть'}
          </button>

          {hasDemo && (
            <button
              type="button"
              onClick={() => void startDemo(game.slug, currency)}
              disabled={demoLoading}
              className="btn-ghost mt-3 w-full py-3 font-semibold"
            >
              {demoLoading ? 'Запуск демо…' : 'Попробовать демо'}
            </button>
          )}

          {/* Деньги — зелёная точка и сумма (ТЗ ч.5.1 §2 пр.4: зелёный только за деньгами) */}
          {user && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00C853]" aria-hidden />
              Активный баланс:
              <span className="font-bold text-white">{formatBalance(balance, currency)}</span>
            </p>
          )}
        </div>
      </div>
    </>
  )
}
