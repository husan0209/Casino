'use client'

import { ChevronLeft, ChevronRight, Dices, Heart, Info, Play, Sparkles, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { GameThumb } from '@/components/casino/GameThumb'
import { apiPost } from '@/lib/api'
import { gameBadge, gameDisplayName, gameRtpLabel } from '@/lib/ui/game'
import { useAuth, type WebUser } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import type { GameDto, GameLaunchDto } from '@/types/casino'

interface GameDeckProps {
  games: GameDto[]
  recentGames?: GameDto[]
  favoriteSlugs?: Set<string>
  onToggleFavorite?: (game: GameDto) => void
}

interface DeckCard {
  game: GameDto
  tag: string
  tagColor: string
}

interface DeckInput {
  games: GameDto[]
  recentGames: GameDto[]
  favoriteSlugs: Set<string>
  user: WebUser | null
}

interface FlyingCard {
  card: DeckCard
  direction: 'left' | 'right'
  startTransform: string
  nonce: number
}

type DeckAnimHint = 'enter' | 'return' | null

interface DragState {
  active: boolean
  pointerId: number
  startX: number
  startY: number
  dx: number
  dy: number
  lastX: number
  lastTime: number
  velocityX: number
  axisLocked: boolean
  vertical: boolean
  moved: boolean
  startTime: number
}

// Стабильные ссылки: литералы [] / new Set() в деструктуризации пропсов дают
// новую ссылку на каждый рендер и зацикливают пересборку колоды.
const EMPTY_RECENT_GAMES: GameDto[] = []
const EMPTY_FAVORITE_SLUGS: Set<string> = new Set<string>()

/** ТЗ §4.4: колода 8–12 карт; телефон 1+2, десктоп 1+3 + очередь мини-тюмбов. */
const DECK_SIZE = 10
const SWIPE_FRACTION = 0.34
const FLING_VELOCITY_PX_MS = 0.5
const DRAG_ROTATION_LIMIT_DEG = 12
const EXIT_ROTATION_DEG = 14
const EXIT_DURATION_MS = 400
const TAP_TOLERANCE_PX = 8
const TAP_DELAY_MS = 280
const DOUBLE_TAP_MS = 320

/** Слои стека: фронт −3°, задние правее-выше с обратным наклоном (мок + §4.4). */
const FRONT_REST_TRANSFORM = 'translate3d(0px, 0px, 0px) rotate(-3deg) scale(1)'
const PROGRAMMATIC_KICK_TRANSFORM = 'translate3d(-2%, 0px, 0px) rotate(-6deg) scale(0.99)'
const BACK_TRANSFORMS = [
  'translate3d(7%, -3%, 0px) rotate(6deg) scale(0.965)',
  'translate3d(14%, -6%, 0px) rotate(11deg) scale(0.93)',
  'translate3d(21%, -9%, 0px) rotate(15deg) scale(0.895)',
] as const

const INITIAL_DRAG_STATE: DragState = {
  active: false,
  pointerId: -1,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
  lastX: 0,
  lastTime: 0,
  velocityX: 0,
  axisLocked: false,
  vertical: false,
  moved: false,
  startTime: 0,
}

/** djb2 с солью: детерминированные мок-цифры «дышат» по слагу, но стабильны между рендерами. */
function hashSlug(slug: string, salt: number): number {
  let hash = 5381 + salt
  for (let symbolIndex = 0; symbolIndex < slug.length; symbolIndex += 1) {
    hash = ((hash << 5) + hash + slug.charCodeAt(symbolIndex)) >>> 0
  }
  return hash
}

/**
 * Мок BIG WIN-плашки (§4.4 «контекстный BIG WIN»): поля «выигрыш по игре» в
 * API нет, цифра витринная; целочисленная хэш-арифметика, `toLocaleString` —
 * только отображение (никаких float-расчётов денег).
 */
function bigWinLabel(slug: string): string {
  const rubles = Math.round((3200 + (hashSlug(slug, 17) % 145300)) / 100) * 100
  return `+${rubles.toLocaleString('ru-RU')} ₽`
}

function onlinePlayersCount(slug: string): number {
  return 241 + (hashSlug(slug, 101) % 4630)
}

function pluralizePlayers(count: number): string {
  const tens = count % 10
  const hundreds = count % 100
  if (tens === 1 && hundreds !== 11) {
    return 'игрок'
  }
  if (tens >= 2 && tens <= 4 && (hundreds < 12 || hundreds > 14)) {
    return 'игрока'
  }
  return 'игроков'
}

// Формируем колоду по ТЗ §4.4: свой (последнее) → избранное → хайп → новинки → остальные.
function buildDeckCards({ games, recentGames, favoriteSlugs, user }: DeckInput): DeckCard[] {
  const list: DeckCard[] = []
  const seen = new Set<string>()

  if (user && recentGames.length > 0) {
    for (const recentGame of recentGames.slice(0, 2)) {
      if (!seen.has(recentGame.slug)) {
        seen.add(recentGame.slug)
        list.push({ game: recentGame, tag: 'Продолжи', tagColor: 'bg-[#6C63FF]/30 text-white' })
      }
    }
  }

  for (const game of games) {
    if (favoriteSlugs.has(game.slug) && !seen.has(game.slug)) {
      seen.add(game.slug)
      list.push({ game, tag: 'Твоё избранное', tagColor: 'bg-[#FF3D71]/30 text-[#FF3D71]' })
      if (list.length >= 4) {
        break
      }
    }
  }

  for (const game of games) {
    if (game.isPopular && !seen.has(game.slug)) {
      seen.add(game.slug)
      list.push({ game, tag: 'Хайп', tagColor: 'bg-[#FFB300]/30 text-[#FFB300]' })
    }
  }

  for (const game of games) {
    if (game.isNew && !seen.has(game.slug)) {
      seen.add(game.slug)
      list.push({ game, tag: 'Новинка', tagColor: 'bg-[#00D2FF]/30 text-[#00D2FF]' })
    }
  }

  for (const game of games) {
    if (!seen.has(game.slug)) {
      seen.add(game.slug)
      list.push({ game, tag: 'Популярное', tagColor: 'bg-white/10 text-white/80' })
    }
  }

  return list.slice(0, DECK_SIZE)
}

/** Launch-переход фронта: улетает вверх и «разворачивается» в слот (§4.4). */
function animateLaunch(frontElement: HTMLDivElement): Promise<void> {
  const startTransform = frontElement.style.transform || FRONT_REST_TRANSFORM
  const animation = frontElement.animate(
    [
      { transform: startTransform, opacity: 1 },
      { transform: 'translate3d(0px, -58%, 0px) rotate(-3deg) scale(1.06)', opacity: 0 },
    ],
    { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
  )
  return animation.finished.then(() => undefined).catch(() => undefined)
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const applyPreference = (): void => setReducedMotion(mediaQuery.matches)
    applyPreference()
    mediaQuery.addEventListener('change', applyPreference)
    return () => mediaQuery.removeEventListener('change', applyPreference)
  }, [])
  return reducedMotion
}

interface DeckCardFaceProps {
  card: DeckCard
  favoriteSlugs: Set<string>
  heartBurst: boolean
  onToggleFavorite: (game: GameDto) => void
  onPlay: (game: GameDto) => void
  onPreview: (card: DeckCard) => void
}

/** Лицевая сторона карты: кавер + тег + BIG WIN + «сейчас играют» + «Играть». */
const DeckCardFace = memo(function DeckCardFace({
  card,
  favoriteSlugs,
  heartBurst,
  onToggleFavorite,
  onPlay,
  onPreview,
}: DeckCardFaceProps): React.JSX.Element {
  const displayName = gameDisplayName(card.game)
  const badge = gameBadge(card.game)
  const isFavorite = favoriteSlugs.has(card.game.slug)
  const playersOnline = onlinePlayersCount(card.game.slug)

  return (
    <div className="absolute inset-0 overflow-hidden rounded-3xl border border-[#2A2A4A] bg-[#16213E] shadow-2xl select-none">
      <GameThumb
        src={card.game.thumbnailUrl}
        alt={displayName}
        sizes="(max-width: 767px) 92vw, 480px"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/15" />

      {/* Тег-причина рекомендации (§4.4) */}
      <span
        className={`deck-rise absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur-md ${card.tagColor}`}
      >
        {card.tag}
      </span>

      {/* Правая колонка: BIG WIN + сердечко + «i» (превью) */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <span className="deck-rise rounded-xl border border-[#FFB300]/30 bg-black/70 px-3 py-1.5 text-right backdrop-blur-md">
          <span className="block text-[10px] font-bold tracking-[0.18em] text-[#FFB300]">
            BIG WIN
          </span>
          <span className="block text-sm font-extrabold leading-tight text-white">
            {bigWinLabel(card.game.slug)}
          </span>
          <span className="block text-[9px] font-semibold tracking-[0.14em] text-white/50">
            ТОЛЬКО ЧТО
          </span>
        </span>
        <div className="deck-rise flex gap-2">
          <button
            type="button"
            onClick={() => onToggleFavorite(card.game)}
            aria-label={isFavorite ? 'Убрать из избранного' : 'В избранное'}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:scale-110"
          >
            <Heart
              size={15}
              className={`${heartBurst ? 'deck-heart-burst ' : ''}${
                isFavorite ? 'fill-[#FF3D71] text-[#FF3D71]' : 'text-white/80'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => onPreview(card)}
            aria-label={`Превью игры «${displayName}»`}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white/80 backdrop-blur-md transition hover:scale-110 hover:text-white"
          >
            <Info size={15} />
          </button>
        </div>
      </div>

      {/* «Сейчас играют» — тонкий живой бейдж на карте (§4.4) */}
      <span className="deck-rise absolute bottom-[4.75rem] right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/85 backdrop-blur-md">
        <span className="deck-live-dot h-1.5 w-1.5 rounded-full bg-[#FF3D71]" />
        {playersOnline.toLocaleString('ru-RU')} {pluralizePlayers(playersOnline)} сейчас в игре
      </span>

      {/* Нижняя плашка: провайдер + бейдж + название + «Играть» (только фронт) */}
      <div className="deck-rise absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs text-white/70">{card.game.provider?.name}</span>
            {badge && (
              <span className="rounded bg-[#00D2FF]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#00D2FF]">
                {badge}
              </span>
            )}
          </div>
          <h3 className="truncate text-xl font-black leading-tight text-white sm:text-2xl">
            {displayName}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => onPlay(card.game)}
          className="flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-[#0E1530]/90 px-5 py-2.5 text-sm font-bold text-white shadow-xl transition hover:border-[#6C63FF] hover:bg-[#141B3D]"
        >
          <Play size={15} className="fill-current" />
          Играть
        </button>
      </div>
    </div>
  )
})

interface FinalCatalogCardProps {
  gamesLeft: number
}

/** Финальная карта колоды: «Ещё N игр в каталоге» — свайп/тап ведёт в /casino (§4.4). */
function FinalCatalogCard({ gamesLeft }: FinalCatalogCardProps): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex select-none flex-col items-center justify-center gap-2 overflow-hidden rounded-3xl border border-dashed border-[#6C63FF]/50 bg-[#16213E]/90 text-center">
      <Sparkles size={22} className="text-[#00E676]" />
      <p className="px-6 text-lg font-black leading-snug text-white">Всё, что выбирал для тебя</p>
      <p className="text-sm text-white/60">
        Ещё {gamesLeft.toLocaleString('ru-RU')} игр в каталоге
      </p>
      <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-[#6C63FF]">
        Открыть каталог
        <ChevronRight size={15} />
      </span>
    </div>
  )
}

const VOLATILITY_LABELS: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
}

function volatilityLabel(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  return VOLATILITY_LABELS[value] ?? value
}

/**
 * Стейт превью «i»: карта, демо-запуск и портал в body (из isolate-секции
 * поверх шапки не подняться). Портал строится только после монтирования —
 * на SSR document недоступен.
 */
function useDeckPreview(onPlayFront: () => void): {
  previewCard: DeckCard | null
  openPreview: (card: DeckCard) => void
  closePreview: () => void
  previewPortal: React.ReactNode
} {
  const [previewCard, setPreviewCard] = useState<DeckCard | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const openPreview = useCallback((card: DeckCard): void => setPreviewCard(card), [])
  const closePreview = useCallback((): void => setPreviewCard(null), [])

  // Демо без регистрации (§4.7): launch_url провайдера в новой вкладке.
  const startDemo = useCallback(async (game: GameDto): Promise<void> => {
    const wallet = useWalletStore.getState()
    const currency = wallet.getActiveWallet()?.currency ?? wallet.activeCurrency
    try {
      const launch = await apiPost<GameLaunchDto>(`/casino/games/${game.slug}/demo`, { currency })
      if (launch.launch_url) {
        window.open(launch.launch_url, '_blank', 'noopener')
      }
    } catch {
      // демо может быть недоступно (провайдер/гео) — остаёмся в превью
    }
  }, [])

  const previewPortal =
    isMounted && previewCard ? (
      <DeckPreview
        card={previewCard}
        onClose={closePreview}
        onPlay={(): void => {
          closePreview()
          onPlayFront()
        }}
        onDemo={startDemo}
      />
    ) : null

  return { previewCard, openPreview, closePreview, previewPortal }
}

interface DeckPreviewProps {
  card: DeckCard
  onClose: () => void
  onPlay: () => void
  onDemo: (game: GameDto) => Promise<void>
}

/**
 * Превью по «i» (§4.7): RTP, волатильность, «Играть» и «Демо» без ухода со
 * страницы. Портал в body: секция колоды изолирована (isolate против шапки),
 * из её stacking context z-50 поверх sticky-хедера не поднять.
 */
function DeckPreview({ card, onClose, onPlay, onDemo }: DeckPreviewProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [demoLoading, setDemoLoading] = useState(false)
  const displayName = gameDisplayName(card.game)
  const rtp = gameRtpLabel(card.game.rtp)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const startDemo = (): void => {
    if (demoLoading) {
      return
    }
    setDemoLoading(true)
    void onDemo(card.game).finally(() => setDemoLoading(false))
  }

  return createPortal(
    <div
      className="deck-preview-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Превью игры «${displayName}»`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="deck-preview-card w-full max-w-sm overflow-hidden rounded-3xl border border-[#2A2A4A] bg-[#16213E] shadow-2xl outline-none"
      >
        <div className="relative aspect-[16/9] w-full">
          <GameThumb src={card.game.thumbnailUrl} alt={displayName} sizes="384px" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#16213E] via-transparent to-transparent" />
          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur-md ${card.tagColor}`}
          >
            {card.tag}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть превью"
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white/80 backdrop-blur-md transition hover:scale-110 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-4">
          <p className="text-xs text-white/60">{card.game.provider?.name}</p>
          <h3 className="mb-3 truncate text-xl font-black text-white">{displayName}</h3>

          <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-black/30 px-3 py-2">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-white/45">RTP</dt>
              <dd className="font-bold text-[#00E676]">{rtp ?? '—'}</dd>
            </div>
            <div className="rounded-xl bg-black/30 px-3 py-2">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-white/45">
                Волатильность
              </dt>
              <dd className="font-bold text-white/85">{volatilityLabel(card.game.volatility)}</dd>
            </div>
          </dl>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onPlay}
              className="btn-money flex-1 py-3 text-sm font-bold"
            >
              <Play size={15} className="mr-1 inline fill-current" />
              Играть
            </button>
            {card.game.hasDemo && (
              <button
                type="button"
                onClick={startDemo}
                disabled={demoLoading}
                className="btn-ghost py-3 px-5 text-sm font-semibold disabled:opacity-50"
              >
                {demoLoading ? 'Запускаем…' : 'Демо'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

interface DeckHeaderProps {
  total: number
  position: number
  onShuffle: () => void
}

function DeckHeader({ total, position, onShuffle }: DeckHeaderProps): React.JSX.Element {
  const onFinalCard = position >= total
  return (
    <div className="mb-3 flex items-center justify-between">
      <div>
        <p className="caps-label flex items-center gap-1">
          <Sparkles size={12} className="text-[#00E676]" />
          ВЫБОР МОМЕНТА
        </p>
        <h2 className="section-title">Колода слотов</h2>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted">
          {onFinalCard ? 'каталог' : `${position + 1} / ${total}`}
        </span>
        <button
          type="button"
          onClick={onShuffle}
          aria-label="Перемешать колоду"
          className="grid h-8 w-8 place-items-center rounded-lg border border-[#2A2A4A] text-muted transition hover:border-brand hover:text-white"
        >
          <Dices size={16} />
        </button>
      </div>
    </div>
  )
}

interface DeckNavProps {
  total: number
  position: number
  onPrev: () => void
  onNext: () => void
  onJump: (cardIndex: number) => void
}

function DeckNav({ total, position, onPrev, onNext, onJump }: DeckNavProps): React.JSX.Element {
  const activeDot = Math.min(position, total - 1)
  return (
    <div className="mt-3 flex items-center justify-between px-2">
      <button
        type="button"
        onClick={onPrev}
        disabled={position === 0}
        className="flex items-center gap-1 text-xs font-semibold text-muted transition hover:text-white disabled:opacity-40"
      >
        <ChevronLeft size={16} />
        <span>Назад</span>
      </button>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, cardIndex) => (
          <button
            key={cardIndex}
            type="button"
            onClick={() => onJump(cardIndex)}
            aria-label={`Карта ${cardIndex + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              cardIndex === activeDot ? 'w-5 bg-[#6C63FF]' : 'w-1.5 bg-white/20 hover:bg-white/40'
            }`}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onNext}
        className="flex items-center gap-1 text-xs font-semibold text-muted transition hover:text-white"
      >
        <span>Дальше</span>
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

interface SwipeDeckState {
  deck: DeckCard[]
  position: number
  shuffleNonce: number
  animHint: DeckAnimHint
  flying: FlyingCard | null
  flyingRef: React.RefObject<HTMLDivElement>
  flyingLockRef: React.MutableRefObject<boolean>
  setAnimHint: (hint: DeckAnimHint) => void
  flyOutNext: (startTransform: string) => void
  goPrev: (startTransform?: string) => void
  handleShuffle: () => void
  handleJump: (cardIndex: number) => void
}

interface SwipeDeckOptions {
  stackRef: React.RefObject<HTMLDivElement>
  games: GameDto[]
  recentGames: GameDto[]
  favoriteSlugs: Set<string>
  user: WebUser | null
  reducedMotion: boolean
  onOpenCatalog: () => void
}

/**
 * Стейт-машина колоды: позиция, улёт карт, пересдача, прыжки по точкам.
 * ТЗ §4.4 «память»: позиция без ротации хвоста — повторов нет, пока все не показаны.
 */
function useSwipeDeck({
  stackRef,
  games,
  recentGames,
  favoriteSlugs,
  user,
  reducedMotion,
  onOpenCatalog,
}: SwipeDeckOptions): SwipeDeckState {
  const builtDeck = useMemo(
    () => buildDeckCards({ games, recentGames, favoriteSlugs, user }),
    [games, recentGames, favoriteSlugs, user],
  )

  const [shuffleNonce, setShuffleNonce] = useState(0)
  const [position, setPosition] = useState(0)
  const [flying, setFlying] = useState<FlyingCard | null>(null)
  const [animHint, setAnimHint] = useState<DeckAnimHint>('enter')

  const flyingRef = useRef<HTMLDivElement>(null)
  const flyingLockRef = useRef(false)

  // Пересдача «кубиком»: первый расклад детерминированный (хайп → …), дальше Fisher-Yates.
  const deck = useMemo(() => {
    if (shuffleNonce === 0) {
      return builtDeck
    }
    const cards = [...builtDeck]
    for (let tailIndex = cards.length - 1; tailIndex > 0; tailIndex -= 1) {
      const swapIndex = Math.floor(Math.random() * (tailIndex + 1))
      const dropped = cards[tailIndex]
      const lifted = cards[swapIndex]
      if (!dropped || !lifted) {
        continue
      }
      cards[tailIndex] = lifted
      cards[swapIndex] = dropped
    }
    return cards
  }, [builtDeck, shuffleNonce])

  // Улёт карты: дуга (translateX + подъём) с доворотом и fade в конце (§4.4).
  useEffect(() => {
    if (!flying) {
      return
    }
    const flyingElement = flyingRef.current
    const stackElement = stackRef.current
    if (!flyingElement || !stackElement) {
      return
    }
    const stackWidth = stackElement.getBoundingClientRect().width
    const exitX = flying.direction === 'left' ? -stackWidth * 1.7 : stackWidth * 1.7
    const exitRotation = flying.direction === 'left' ? -EXIT_ROTATION_DEG : EXIT_ROTATION_DEG
    const animation = flyingElement.animate(
      [
        { transform: flying.startTransform, opacity: 1 },
        {
          transform: `translate3d(${exitX * 0.45}px, -16px, 0px) rotate(${exitRotation * 0.6}deg) scale(0.99)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate3d(${exitX}px, -44px, 0px) rotate(${exitRotation}deg) scale(0.96)`,
          opacity: 0,
        },
      ],
      { duration: EXIT_DURATION_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'forwards' },
    )
    let cancelled = false
    animation.finished
      .then(() => {
        if (!cancelled) {
          setFlying(null)
          flyingLockRef.current = false
          // Haptic tick на доводке новой фронт-карты (§4.4); на десктопе no-op.
          if (typeof navigator.vibrate === 'function') {
            navigator.vibrate(8)
          }
        }
      })
      .catch(() => {
        flyingLockRef.current = false
      })
    return () => {
      cancelled = true
      animation.cancel()
    }
  }, [flying, stackRef])

  const flyOutNext = (startTransform: string): void => {
    if (flyingLockRef.current) {
      return
    }
    const frontCard = deck[position]
    if (!frontCard) {
      onOpenCatalog()
      return
    }
    if (reducedMotion) {
      setPosition((prev) => prev + 1)
      setAnimHint('enter')
      return
    }
    flyingLockRef.current = true
    setFlying({ card: frontCard, direction: 'left', startTransform, nonce: performance.now() })
    setPosition((prev) => prev + 1)
    setAnimHint('enter')
  }

  // Обратный свайп: текущая уходит вправо, предыдущая возвращается (§4.4).
  const goPrev = (startTransform: string = FRONT_REST_TRANSFORM): void => {
    if (flyingLockRef.current || position === 0) {
      return
    }
    const frontCard = deck[position]
    if (frontCard && !reducedMotion) {
      flyingLockRef.current = true
      setFlying({ card: frontCard, direction: 'right', startTransform, nonce: performance.now() })
    }
    setPosition((prev) => prev - 1)
    setAnimHint('return')
  }

  const handleShuffle = (): void => {
    if (flyingLockRef.current) {
      return
    }
    setShuffleNonce((prev) => prev + 1)
    setPosition(0)
    setAnimHint('enter')
  }

  const handleJump = (cardIndex: number): void => {
    if (flyingLockRef.current || cardIndex === position) {
      return
    }
    setPosition(cardIndex)
    setAnimHint('enter')
  }

  return {
    deck,
    position,
    shuffleNonce,
    animHint,
    flying,
    flyingRef,
    flyingLockRef,
    setAnimHint,
    flyOutNext,
    goPrev,
    handleShuffle,
    handleJump,
  }
}

interface CardDragOptions {
  stackRef: React.RefObject<HTMLDivElement>
  frontRef: React.RefObject<HTMLDivElement>
  reducedMotion: boolean
  isLocked: () => boolean
  canSwipePrev: () => boolean
  onSwipeNext: (startTransform: string) => void
  onSwipePrev: (startTransform: string) => void
  onTapLaunch: () => void
  onDoubleTap: () => void
}

interface CardDragHandlers {
  onPointerDown: React.PointerEventHandler<HTMLDivElement>
  onPointerMove: React.PointerEventHandler<HTMLDivElement>
  onPointerUp: React.PointerEventHandler<HTMLDivElement>
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>
  isDragging: () => boolean
}

/**
 * Жесты фронта колоды (§4.4, матрица): ось-лок (вертикаль отдана скроллу на
 * телефоне), порог 1/3 ширины или флинг по скорости, тап = запуск, двойной
 * тап = избранное. Drag пишет transform напрямую в DOM — без setState на
 * каждое движение (60fps, только transform/opacity).
 */
function useCardDrag({
  stackRef,
  frontRef,
  reducedMotion,
  isLocked,
  canSwipePrev,
  onSwipeNext,
  onSwipePrev,
  onTapLaunch,
  onDoubleTap,
}: CardDragOptions): CardDragHandlers {
  const dragRef = useRef<DragState>(INITIAL_DRAG_STATE)
  const tapTimerRef = useRef<number | null>(null)
  const lastTapRef = useRef(0)

  // Пружина возврата с лёгким овершутом — «резинка», как у tinder-колод.
  const springBack = (): void => {
    const frontElement = frontRef.current
    if (!frontElement) {
      return
    }
    const currentTransform = frontElement.style.transform
    if (currentTransform.length === 0 || currentTransform === FRONT_REST_TRANSFORM) {
      return
    }
    if (reducedMotion) {
      frontElement.style.transform = FRONT_REST_TRANSFORM
      return
    }
    const animation = frontElement.animate(
      [
        { transform: currentTransform },
        { transform: 'translate3d(1%, -1px, 0px) rotate(-2.2deg) scale(1.005)' },
        { transform: FRONT_REST_TRANSFORM },
      ],
      { duration: 380, easing: 'cubic-bezier(0.3, 0.9, 0.3, 1)', fill: 'forwards' },
    )
    animation.finished
      .then(() => {
        animation.commitStyles()
        animation.cancel()
      })
      .catch(() => {
        animation.cancel()
      })
  }

  const handleTap = (event: React.PointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('button, a')) {
      return
    }
    const tappedAt = Date.now()
    if (tappedAt - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current)
        tapTimerRef.current = null
      }
      onDoubleTap()
      return
    }
    lastTapRef.current = tappedAt
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null
      onTapLaunch()
    }, TAP_DELAY_MS)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (isLocked() || event.button !== 0) {
      return
    }
    // Кнопки/ссылки внутри карты живут своей жизнью (pointer capture ломал бы их click).
    if ((event.target as HTMLElement).closest('button, a')) {
      return
    }
    const frontElement = frontRef.current
    if (!frontElement) {
      return
    }
    dragRef.current = {
      ...INITIAL_DRAG_STATE,
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      startTime: event.timeStamp,
    }
    // Захват может сорваться (стилус/инъекция событий/уже снятый указатель) —
    // жест тогда живёт, пока курсор внутри карты, это не повод ронять обработчик.
    try {
      frontElement.setPointerCapture(event.pointerId)
    } catch {
      // без захвата: move-события придут, пока курсор над картой
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag.active || event.pointerId !== drag.pointerId) {
      return
    }
    const nextDx = event.clientX - drag.startX
    const nextDy = event.clientY - drag.startY
    const deltaTime = Math.max(event.timeStamp - drag.lastTime, 1)
    const sampleVelocity = (event.clientX - drag.lastX) / deltaTime
    drag.velocityX = drag.velocityX * 0.75 + sampleVelocity * 0.25
    drag.lastX = event.clientX
    drag.lastTime = event.timeStamp
    drag.dx = nextDx
    drag.dy = nextDy

    const distance = Math.hypot(nextDx, nextDy)
    if (distance > TAP_TOLERANCE_PX) {
      drag.moved = true
    }
    if (!drag.axisLocked && distance > TAP_TOLERANCE_PX) {
      drag.axisLocked = true
      drag.vertical = Math.abs(nextDy) > Math.abs(nextDx) * 1.3
    }

    const frontElement = frontRef.current
    if (!frontElement) {
      return
    }
    // Телефон: вертикаль отдана скроллу (touch-action: pan-y) — браузер сам прервёт жест.
    if (drag.vertical && event.pointerType === 'touch') {
      return
    }
    if (drag.vertical) {
      // Десктоп: драг вверх — запуск (матрица жестов §4.4).
      const liftScale = nextDy < 0 ? 1 + Math.min(-nextDy, 120) / 900 : 1
      frontElement.style.transform = `translate3d(0px, ${nextDy * 0.6}px, 0px) rotate(-3deg) scale(${liftScale})`
      return
    }
    const stackWidth = stackRef.current?.getBoundingClientRect().width ?? 320
    const rotation = Math.max(
      Math.min((nextDx / stackWidth) * 16, DRAG_ROTATION_LIMIT_DEG),
      -DRAG_ROTATION_LIMIT_DEG,
    )
    frontElement.style.transform = `translate3d(${nextDx}px, ${nextDy * 0.25}px, 0px) rotate(${-3 + rotation}deg) scale(1)`
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag.active || event.pointerId !== drag.pointerId) {
      return
    }
    drag.active = false
    const frontElement = frontRef.current
    const draggedTransform = frontElement?.style.transform ?? ''

    if (!drag.moved) {
      handleTap(event)
      return
    }
    if (drag.vertical) {
      if (drag.dy < -90 && event.pointerType !== 'touch') {
        onTapLaunch()
        return
      }
      springBack()
      return
    }
    const stackWidth = stackRef.current?.getBoundingClientRect().width ?? 320
    const passedDistance = Math.abs(drag.dx) > stackWidth * SWIPE_FRACTION
    const passedVelocity = Math.abs(drag.velocityX) > FLING_VELOCITY_PX_MS
    if (!passedDistance && !passedVelocity) {
      springBack()
      return
    }
    if (drag.dx < 0 || drag.velocityX < -FLING_VELOCITY_PX_MS) {
      onSwipeNext(draggedTransform.length > 0 ? draggedTransform : FRONT_REST_TRANSFORM)
      return
    }
    // Свайп вправо — предыдущая карта; на первой — резинка назад.
    if (canSwipePrev()) {
      onSwipePrev(draggedTransform.length > 0 ? draggedTransform : FRONT_REST_TRANSFORM)
      return
    }
    springBack()
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag.active || event.pointerId !== drag.pointerId) {
      return
    }
    drag.active = false
    springBack()
  }

  const isDragging = (): boolean => dragRef.current.active

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    isDragging,
  }
}

/** Десктоп: hover-tilt фронта (§4.4) — напрямую в DOM, без ререндеров. */
function useHoverTilt(
  stackRef: React.RefObject<HTMLDivElement>,
  frontRef: React.RefObject<HTMLDivElement>,
  isIdle: () => boolean,
): {
  handleStackMouseMove: React.MouseEventHandler<HTMLDivElement>
  handleStackMouseLeave: React.MouseEventHandler<HTMLDivElement>
} {
  const hoverFrameRef = useRef(0)

  const glideToRest = (): void => {
    const frontElement = frontRef.current
    if (!frontElement) {
      return
    }
    const currentTransform = frontElement.style.transform
    if (currentTransform.length === 0 || currentTransform === FRONT_REST_TRANSFORM) {
      return
    }
    const animation = frontElement.animate(
      [{ transform: currentTransform }, { transform: FRONT_REST_TRANSFORM }],
      { duration: 240, easing: 'ease-out', fill: 'forwards' },
    )
    animation.finished
      .then(() => {
        animation.commitStyles()
        animation.cancel()
      })
      .catch(() => {
        animation.cancel()
      })
  }

  const handleStackMouseMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!isIdle() || !window.matchMedia('(hover: hover)').matches) {
      return
    }
    const frontElement = frontRef.current
    const stackElement = stackRef.current
    if (!frontElement || !stackElement) {
      return
    }
    const stackRect = stackElement.getBoundingClientRect()
    const hoverX = (event.clientX - stackRect.left) / stackRect.width - 0.5
    const hoverY = (event.clientY - stackRect.top) / stackRect.height - 0.5
    if (hoverFrameRef.current !== 0) {
      return
    }
    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = 0
      frontElement.style.transform = `translate3d(${hoverX * 8}px, ${hoverY * 4}px, 0px) rotate(${-3 + hoverX * 3}deg) scale(1)`
    })
  }

  const handleStackMouseLeave = (): void => {
    if (isIdle()) {
      glideToRest()
    }
  }

  return { handleStackMouseMove, handleStackMouseLeave }
}

/**
 * Глобальные стили анимаций колоды (§4.4): пружина входа 0.94→1.02→1,
 * возврат предыдущей, фейды слоёв, slide-up плашек (+80ms), heart-burst,
 * live-точка; reduced-motion — кроссфейд вместо пружин.
 */
function DeckGlobalStyles(): React.JSX.Element {
  return (
    <style jsx global>{`
      .deck-stack {
        touch-action: pan-y;
      }
      .deck-stack img,
      .deck-card img {
        -webkit-user-drag: none;
        user-select: none;
      }
      /* Вход следующей: scale 0.94 → овершут 1.02 → 1, 340ms пружина (§4.4). */
      .deck-card-enter {
        animation: deckEnter 340ms cubic-bezier(0.22, 1.35, 0.36, 1) both;
      }
      @keyframes deckEnter {
        0% {
          transform: translate3d(0px, 12px, 0px) rotate(0deg) scale(0.94);
          opacity: 0.5;
        }
        60% {
          transform: translate3d(0px, -3px, 0px) rotate(-3.4deg) scale(1.02);
          opacity: 1;
        }
        100% {
          transform: translate3d(0px, 0px, 0px) rotate(-3deg) scale(1);
          opacity: 1;
        }
      }
      /* Возврат предыдущей: въезжает справа, откуда ушла. */
      .deck-card-return {
        animation: deckReturn 360ms cubic-bezier(0.22, 1.25, 0.36, 1) both;
      }
      @keyframes deckReturn {
        0% {
          transform: translate3d(42%, 0px, 0px) rotate(10deg) scale(0.97);
          opacity: 0;
        }
        100% {
          transform: translate3d(0px, 0px, 0px) rotate(-3deg) scale(1);
          opacity: 1;
        }
      }
      .deck-fade {
        animation: deckFade 260ms ease both;
      }
      @keyframes deckFade {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      /* Плашки фронт-карты: +80ms slide-up + fade (§4.4). */
      .deck-rise {
        animation: deckRise 320ms cubic-bezier(0.22, 1.2, 0.36, 1) 80ms both;
      }
      @keyframes deckRise {
        from {
          transform: translateY(10px);
          opacity: 0;
        }
        to {
          transform: translateY(0px);
          opacity: 1;
        }
      }
      .deck-live-dot {
        animation: deckPulse 1.6s ease-in-out infinite;
      }
      @keyframes deckPulse {
        0%,
        100% {
          opacity: 1;
          box-shadow: 0 0 0 0 rgba(255, 61, 113, 0.5);
        }
        50% {
          opacity: 0.65;
          box-shadow: 0 0 0 4px rgba(255, 61, 113, 0);
        }
      }
      .deck-heart-burst {
        animation: deckBurst 450ms cubic-bezier(0.22, 1.4, 0.36, 1);
      }
      @keyframes deckBurst {
        0% {
          transform: scale(1);
        }
        45% {
          transform: scale(1.55);
        }
        100% {
          transform: scale(1);
        }
      }
      .deck-preview-overlay {
        animation: deckFade 180ms ease both;
      }
      .deck-preview-card {
        animation: deckPreviewIn 260ms cubic-bezier(0.22, 1.2, 0.36, 1) both;
      }
      @keyframes deckPreviewIn {
        from {
          transform: translateY(14px) scale(0.96);
          opacity: 0;
        }
        to {
          transform: translateY(0px) scale(1);
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .deck-card-enter,
        .deck-card-return,
        .deck-fade,
        .deck-rise,
        .deck-preview-overlay,
        .deck-preview-card {
          animation: deckReduced 160ms linear both;
        }
        .deck-live-dot,
        .deck-heart-burst {
          animation: none;
        }
      }
      @keyframes deckReduced {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
    `}</style>
  )
}

interface DeckBacksProps {
  backs: DeckCard[]
}

/** Задние слои стека 1+2 (телефон) / 1+3 (десктоп): правее-выше, притушены. */
function DeckBacks({ backs }: DeckBacksProps): React.JSX.Element {
  return (
    <>
      {backs.map((backCard, backIndex) => (
        <div
          key={`back-${backCard.game.slug}`}
          aria-hidden
          className={`deck-fade pointer-events-none absolute inset-0 ${backIndex === 2 ? 'hidden lg:block' : ''}`}
          style={{
            transform: BACK_TRANSFORMS[backIndex] ?? BACK_TRANSFORMS[2],
            zIndex: 20 - backIndex,
            filter:
              backIndex === 2
                ? 'brightness(0.7)'
                : backIndex === 1
                  ? 'brightness(0.85)'
                  : undefined,
            animationDelay: `${(backIndex + 1) * 70}ms`,
          }}
        >
          <div className="absolute inset-0 overflow-hidden rounded-3xl border border-[#2A2A4A] bg-[#16213E] shadow-xl">
            <GameThumb src={backCard.game.thumbnailUrl} alt="" sizes="480px" />
            <div className="absolute inset-0 bg-black/25" />
          </div>
        </div>
      ))}
    </>
  )
}

interface DeckQueueProps {
  entries: DeckCard[]
  startIndex: number
  onJump: (cardIndex: number) => void
}

/** Десктоп: боковая очередь следующих 4 мини-тюмбов (§4.4). */
function DeckQueue({ entries, startIndex, onJump }: DeckQueueProps): React.JSX.Element | null {
  if (entries.length === 0) {
    return null
  }
  return (
    <div className="absolute top-1/2 right-[-5.5rem] z-10 hidden -translate-y-1/2 flex-col gap-2 lg:flex xl:right-[-7rem]">
      {entries.map((queueCard, queueIndex) => (
        <button
          key={`queue-${queueCard.game.slug}`}
          type="button"
          onClick={() => onJump(startIndex + queueIndex)}
          aria-label={`Перейти к «${gameDisplayName(queueCard.game)}»`}
          className="relative h-12 w-12 overflow-hidden rounded-xl border border-[#2A2A4A] opacity-70 transition hover:-translate-y-0.5 hover:border-[#6C63FF] hover:opacity-100"
        >
          <GameThumb src={queueCard.game.thumbnailUrl} alt="" sizes="48px" />
        </button>
      ))}
    </div>
  )
}

interface DeckHotkeysOptions {
  isBlocked: () => boolean
  onSwipeNext: () => void
  onSwipePrev: () => void
  onLaunch: () => void
}

/** Десктоп: ← / → / Enter (матрица жестов §4.4). Превью открыто — клавиши спят. */
function useDeckHotkeys({
  isBlocked,
  onSwipeNext,
  onSwipePrev,
  onLaunch,
}: DeckHotkeysOptions): React.KeyboardEventHandler<HTMLDivElement> {
  return (event): void => {
    if (isBlocked()) {
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onSwipeNext()
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      onSwipePrev()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onLaunch()
    }
  }
}

/**
 * Тиндер-колода главной (ТЗ 5.1 §4.4): свайпаемый стек с пружинной физикой —
 * WAAPI + CSS-кейфреймы, только transform/opacity; drag мимо реакта (60fps).
 */
export function GameDeck({
  games,
  recentGames = EMPTY_RECENT_GAMES,
  favoriteSlugs = EMPTY_FAVORITE_SLUGS,
  onToggleFavorite,
}: GameDeckProps): React.JSX.Element | null {
  const { user } = useAuth()
  const { openLogin } = useUIStore()
  const router = useRouter()
  const reducedMotion = usePrefersReducedMotion()

  const stackRef = useRef<HTMLDivElement>(null)
  const frontRef = useRef<HTMLDivElement>(null)
  const heartTimerRef = useRef<number | null>(null)
  const [heartBurst, setHeartBurst] = useState(false)

  const openCatalog = (): void => {
    router.push('/casino')
  }

  const swipeDeck = useSwipeDeck({
    stackRef,
    games,
    recentGames,
    favoriteSlugs,
    user,
    reducedMotion,
    onOpenCatalog: openCatalog,
  })
  const {
    deck,
    position,
    shuffleNonce,
    animHint,
    flying,
    flyOutNext,
    goPrev,
    handleShuffle,
    handleJump,
  } = swipeDeck

  // Запуск фронта: гость — логин-гейт, свой — launch-переход и страница игры.
  const launchFront = (): void => {
    const frontCard = deck[position]
    if (!frontCard) {
      openCatalog()
      return
    }
    if (!user) {
      openLogin(frontCard.game.slug)
      return
    }
    const frontElement = frontRef.current
    if (!reducedMotion && frontElement) {
      void animateLaunch(frontElement).then(() => {
        router.push(`/casino/${frontCard.game.slug}?launch=1`)
      })
      return
    }
    router.push(`/casino/${frontCard.game.slug}?launch=1`)
  }

  // Двойной тап — в избранное с heart-burst (§4.4).
  const handleDoubleTap = (): void => {
    const frontCard = deck[position]
    if (!frontCard || !onToggleFavorite) {
      return
    }
    onToggleFavorite(frontCard.game)
    setHeartBurst(true)
    if (heartTimerRef.current !== null) {
      window.clearTimeout(heartTimerRef.current)
    }
    heartTimerRef.current = window.setTimeout(() => {
      heartTimerRef.current = null
      setHeartBurst(false)
    }, 500)
  }

  // Превью «i»: карта + демо + портал; launchFront нужен для кнопки «Играть».
  const preview = useDeckPreview(launchFront)

  // Превью открыто — жесты и клавиатура колоды спят (модал живёт своей жизнью).
  const isDeckBusy = (): boolean => swipeDeck.flyingLockRef.current || preview.previewCard !== null

  const dragHandlers = useCardDrag({
    stackRef,
    frontRef,
    reducedMotion,
    isLocked: isDeckBusy,
    canSwipePrev: (): boolean => position > 0,
    onSwipeNext: flyOutNext,
    onSwipePrev: goPrev,
    onTapLaunch: launchFront,
    onDoubleTap: handleDoubleTap,
  })

  // isDragging — служебный предикат для hover-tilt; в DOM его не разворачиваем.
  const { isDragging: isCardDragging, ...pointerHandlers } = dragHandlers

  // Hover-tilt живёт только когда ни drag, ни улёт карты активны.
  const { handleStackMouseMove, handleStackMouseLeave } = useHoverTilt(stackRef, frontRef, () => {
    return !isDeckBusy() && !isCardDragging()
  })

  const handleKeyDown = useDeckHotkeys({
    isBlocked: isDeckBusy,
    onSwipeNext: (): void => flyOutNext(PROGRAMMATIC_KICK_TRANSFORM),
    onSwipePrev: (): void => goPrev(),
    onLaunch: launchFront,
  })

  if (deck.length === 0) {
    return null
  }

  const visibleBacks = deck.slice(position + 1, position + 4)
  const queueEntries = deck.slice(position + 4, position + 8)
  const frontCard = deck[position]
  const frontClasses =
    'absolute inset-0 z-30 cursor-grab touch-pan-y active:cursor-grabbing' +
    `${animHint === 'enter' ? ' deck-card-enter' : ''}` +
    `${animHint === 'return' ? ' deck-card-return' : ''}`

  return (
    /* isolate: все z-слои колоды (задние 20 / фронт 30 / улёт 40) живут внутри
       собственного stacking context и не рисуются поверх sticky-шапки (z-30).
       overflow-x-clip: веер задних карт не создаёт горизонтальный скролл
       страницы; сам section на всю ширину вьюпорта, поэтому свайп не режется. */
    <section className="mb-8 isolate overflow-x-clip">
      <DeckHeader total={deck.length} position={position} onShuffle={handleShuffle} />

      <div className="relative mx-auto max-w-md">
        {/* Свечение за колодой (по моку) */}
        <div
          aria-hidden
          className="absolute -inset-5 -z-10 rounded-[2.5rem] bg-[#6C63FF]/15 blur-3xl"
        />

        <div
          ref={stackRef}
          role="group"
          aria-label="Колода игр: свайп влево или стрелка влево — следующая, вправо — предыдущая, Enter — запуск"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onMouseMove={handleStackMouseMove}
          onMouseLeave={handleStackMouseLeave}
          className="deck-stack relative aspect-[16/10] w-full outline-none sm:aspect-[16/9]"
        >
          {/* key по shuffleNonce — пересдача перемонтирует стек: фейды слоёв и вход фронта replay'ятся */}
          <div key={`deal-${shuffleNonce}`} className="absolute inset-0">
            <DeckBacks backs={visibleBacks} />

            {frontCard ? (
              <div
                ref={frontRef}
                key={`front-${frontCard.game.slug}`}
                className={frontClasses}
                style={{ transform: FRONT_REST_TRANSFORM }}
                onAnimationEnd={() => swipeDeck.setAnimHint(null)}
                {...pointerHandlers}
              >
                <DeckCardFace
                  card={frontCard}
                  favoriteSlugs={favoriteSlugs}
                  heartBurst={heartBurst}
                  onToggleFavorite={(game: GameDto): void => onToggleFavorite?.(game)}
                  onPlay={launchFront}
                  onPreview={preview.openPreview}
                />
              </div>
            ) : (
              <div
                ref={frontRef}
                key="front-final"
                className={frontClasses}
                style={{ transform: FRONT_REST_TRANSFORM }}
                onAnimationEnd={() => swipeDeck.setAnimHint(null)}
                {...pointerHandlers}
              >
                <FinalCatalogCard gamesLeft={Math.max(games.length - deck.length, 1)} />
              </div>
            )}

            {flying ? (
              <div
                key={`flying-${flying.nonce}`}
                ref={swipeDeck.flyingRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 z-40"
                style={{ transform: flying.startTransform }}
              >
                <DeckCardFace
                  card={flying.card}
                  favoriteSlugs={favoriteSlugs}
                  heartBurst={false}
                  onToggleFavorite={(game: GameDto): void => onToggleFavorite?.(game)}
                  onPlay={launchFront}
                  onPreview={preview.openPreview}
                />
              </div>
            ) : null}
          </div>

          <DeckQueue entries={queueEntries} startIndex={position + 4} onJump={handleJump} />
        </div>

        <DeckNav
          total={deck.length}
          position={position}
          onPrev={() => goPrev()}
          onNext={() => flyOutNext(PROGRAMMATIC_KICK_TRANSFORM)}
          onJump={handleJump}
        />
      </div>

      {/* Портал рендерится в document.body: из isolate-секции поверх шапки не подняться */}
      {preview.previewPortal}

      <DeckGlobalStyles />
    </section>
  )
}
