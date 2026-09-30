'use client'

import { ArrowRight, ChevronLeft, ChevronRight, Dices, Heart, Play, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { GameThumb } from '@/components/casino/GameThumb'
import { gameCountLabel } from '@/lib/format/plural'
import { gameBadge, gameDisplayName } from '@/lib/ui/game'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import type { GameDto } from '@/types/casino'

// Стабильные дефолты: `= []` / `= new Set()` в сигнатуре создают новую ссылку
// на каждом рендере и роняют useMemo/useCallback-зависимости в цикл
const EMPTY_RECENT: GameDto[] = []
const EMPTY_FAVORITE_SLUGS = new Set<string>()

// Слои-подложки: вторая scale 0.94 и +10px ниже, третья глубже и притушена (§4.4).
// Сдвиг больше, чем усадка масштабом, иначе задние карты прячутся под фронтом.
const LAYER_SCALE = 0.06
const LAYER_DROP = 16
const LAYER_FAN = 22
// Порог свайпа — треть ширины; уход по дуге с доворотом до 12°
const SWIPE_FRACTION = 1 / 3
const MAX_TILT = 12

interface GameDeckProps {
  games: GameDto[]
  recentGames?: GameDto[]
  favoriteSlugs?: Set<string>
  onToggleFavorite?: (game: GameDto) => void
  /** Всего игр в каталоге: нужно финальной карте «Ещё N игр в каталоге →». */
  catalogTotal?: number
}

interface DeckCard {
  game: GameDto
  tag: string
  tagColor: string
}

interface BuildDeckArgs {
  games: GameDto[]
  recentGames: GameDto[]
  favoriteSlugs: Set<string>
  isAuthed: boolean
}

// Колода 8-10 карт по ТЗ §4.4: «Продолжи» → избранные → хайп → новинки → остальное
function buildDeck({
  games,
  recentGames,
  favoriteSlugs,
  isAuthed,
}: BuildDeckArgs): DeckCard[] {
  const list: DeckCard[] = []
  const seen = new Set<string>()
  const push = (game: GameDto, tag: string, tagColor: string): void => {
    if (seen.has(game.slug)) {
      return
    }
    seen.add(game.slug)
    list.push({ game, tag, tagColor })
  }

  // Свой: последнее/избранное первым
  if (isAuthed) {
    for (const g of recentGames.slice(0, 2)) {
      push(g, 'Продолжи', 'bg-[#6C63FF] text-white')
    }
    for (const g of games) {
      if (favoriteSlugs.has(g.slug)) {
        push(g, 'Твоё избранное', 'bg-[#FF3D71] text-white')
      }
    }
  }

  for (const g of games) {
    if (g.isPopular) {
      push(g, 'Хайп', 'bg-[#FFB300] text-[#3A2400]')
    }
  }

  for (const g of games) {
    if (g.isNew) {
      push(g, 'Новинка', 'bg-[#00D2FF] text-[#032A3A]')
    }
  }

  for (const g of games) {
    push(g, 'Популярное', 'bg-white/15 text-white')
  }

  return list.slice(0, 10)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Шапка колоды: подпись, заголовок, счётчик и кнопка пересдачи. */
function DeckHeader({
  shown,
  total,
  onShuffle,
}: {
  shown: number
  total: number
  onShuffle: () => void
}): React.JSX.Element {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div>
        <p className="caps-label flex items-center gap-1">
          <Sparkles size={12} className="text-[#8B7FFF]" />
          ВЫБОР МОМЕНТА
        </p>
        <h2 className="section-title">Колода слотов</h2>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted">
          {shown} / {total}
        </span>
        <button
          type="button"
          onClick={onShuffle}
          aria-label="Пересдать колоду"
          className="grid h-8 w-8 place-items-center rounded-lg border border-[#2A2A4A] text-muted transition hover:border-brand hover:text-white"
        >
          <Dices size={16} />
        </button>
      </div>
    </div>
  )
}

/**
 * Карта стека. Живой пульс (§4.4) — плашки «Крупный выигрыш» и «Сейчас играют» —
 * крепится к конкретной карте и уходит вместе со свайпом, поэтому рендерится
 * только на фронте; задние слои остаются декорацией (aria-hidden).
 */
function DeckStackCard({
  card,
  front,
  isFavorite,
  style,
  onToggleFavorite,
  onLaunch,
  onPreview,
}: {
  card: DeckCard
  front: boolean
  isFavorite: boolean
  style: React.CSSProperties
  onToggleFavorite: ((game: GameDto) => void) | undefined
  onLaunch: (game: GameDto) => void
  onPreview: (game: GameDto) => void
}): React.JSX.Element {
  const displayName = gameDisplayName(card.game)
  const badge = gameBadge(card.game)

  return (
    <div
      aria-hidden={!front}
      className="absolute inset-0 overflow-hidden rounded-3xl border border-[#2A2A4A] bg-[#16213E] shadow-2xl"
      style={style}
    >
      <GameThumb src={card.game.thumbnailUrl} alt={displayName} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/20" />

      {/* Верхняя плашка: причина рекомендации + избранное и «i» (матрица жестов §4.4) */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${card.tagColor}`}>
          {card.tag}
        </span>

        {front && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggleFavorite?.(card.game)}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:scale-110"
              aria-label="В избранное"
            >
              <Heart
                size={16}
                className={isFavorite ? 'fill-[#FF3D71] text-[#FF3D71]' : 'text-white/80'}
              />
            </button>
            <button
              type="button"
              onClick={() => onPreview(card.game)}
              aria-label="Об игре"
              aria-haspopup="dialog"
              className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-xs font-semibold text-white/80 backdrop-blur-md transition hover:scale-110 hover:text-white"
            >
              i
            </button>
          </div>
        )}
      </div>

      {front && (
        <>
          <div className="absolute right-4 bottom-20 rounded-xl border border-[#00C853]/30 bg-black/70 px-3 py-1.5 text-xs backdrop-blur-md sm:bottom-24">
            <div className="text-[10px] text-muted">Крупный выигрыш</div>
            <div className="font-extrabold text-[#00C853]">+32 400 ₽</div>
          </div>

          <div className="absolute bottom-20 left-4 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 text-[10px] text-white/75 backdrop-blur-md sm:bottom-24">
            <span
              className="h-1.5 w-1.5 rounded-full bg-[#00D2FF] shadow-[0_0_7px_#00D2FF]"
              aria-hidden
            />
            Сейчас играют
          </div>
        </>
      )}

      {/* Низ фронт-карты: название + единственная кнопка «Играть» (§4.4) */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 sm:p-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/70">{card.game.provider?.name}</span>
            {badge && (
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase text-white ${
                  badge === 'NEW' ? 'bg-[#6C63FF]' : 'bg-[#FF3D71]'
                }`}
              >
                {badge}
              </span>
            )}
          </div>
          <h3 className="truncate text-xl font-black text-white sm:text-2xl">{displayName}</h3>
        </div>

        {front && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onLaunch(card.game)
            }}
            className="btn shrink-0 px-6 py-3 font-bold shadow-xl"
          >
            <Play size={16} className="fill-current" />
            <span>Играть</span>
          </button>
        )}
      </div>
    </div>
  )
}

/** Финальная карта колоды: свайп в неё и кнопка ведут в каталог (§4.4). */
function DeckFinaleCard({
  remaining,
  drag,
  fade,
}: {
  remaining: number
  drag: number
  fade: number
}): React.JSX.Element {
  return (
    <div
      className="absolute inset-0 z-30 grid place-content-center gap-3 rounded-3xl border border-dashed border-[#6C63FF]/50 bg-[#16213E]/95 p-6 text-center"
      style={{ transform: `translateX(${drag}px)`, opacity: fade }}
    >
      <p className="caps-label">КАТАЛОГ</p>
      <div className="text-2xl font-black text-white">
        Ещё {gameCountLabel(remaining)} в каталоге
      </div>
      <Link href="/casino" className="btn mx-auto mt-2 w-fit px-6 py-3 font-bold">
        <span>Открыть каталог</span>
        <ArrowRight size={16} />
      </Link>
    </div>
  )
}

/** Десктоп: боковая кликабельная очередь следующих 4 мини-тюмбов (§4.4). */
function DeckQueue({
  deck,
  from,
  onGo,
}: {
  deck: DeckCard[]
  from: number
  onGo: (index: number) => void
}): React.JSX.Element {
  return (
    <div className="hidden w-24 shrink-0 flex-col gap-2 lg:flex">
      {deck.slice(from, from + 4).map((card, offset) => (
        <button
          key={card.game.slug}
          type="button"
          onClick={() => onGo(from + offset)}
          className="relative aspect-square overflow-hidden rounded-xl border border-[#2A2A4A] transition hover:border-[#6C63FF]"
          aria-label={`Показать ${gameDisplayName(card.game)}`}
        >
          <GameThumb
            src={card.game.thumbnailUrl}
            alt=""
            seed={gameDisplayName(card.game)}
            sizes="96px"
          />
          <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-1 text-[10px] text-white/80">
            {gameDisplayName(card.game)}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Точки + стрелки под стеком; на телефоне работают как тапы, на десктопе как hover. */
function DeckPager({
  total,
  index,
  lastIndex,
  onGo,
}: {
  total: number
  index: number
  lastIndex: number
  onGo: (index: number) => void
}): React.JSX.Element {
  return (
    <div className="mx-auto mt-3 flex max-w-md items-center justify-between px-2">
      <button
        type="button"
        onClick={() => onGo(index - 1)}
        disabled={index === 0}
        className="flex items-center gap-1 text-xs font-semibold text-muted transition hover:text-white disabled:opacity-30"
      >
        <ChevronLeft size={16} />
        <span>Назад</span>
      </button>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onGo(i)}
            aria-label={`Карта ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? 'w-5 bg-[#6C63FF]' : 'w-1.5 bg-white/20 hover:bg-white/40'
            }`}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onGo(index + 1)}
        disabled={index >= lastIndex}
        className="flex items-center gap-1 text-xs font-semibold text-muted transition hover:text-white disabled:opacity-30"
      >
        <span>Дальше</span>
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

/**
 * Колода (ТЗ ч.5.1 §4.4): свайпаемый стек — 1+2 на телефоне, 1+3 + очередь
 * следующих четырёх на десктопе; каждый свайп — новая игра. Драг вверх
 * запрещён, вертикаль отдана скроллу страницы: горизонталь перехватываем
 * только когда движение оказалось явно боковым.
 */
export function GameDeck({
  games,
  recentGames = EMPTY_RECENT,
  favoriteSlugs = EMPTY_FAVORITE_SLUGS,
  onToggleFavorite,
  catalogTotal,
}: GameDeckProps): React.JSX.Element | null {
  const { user } = useAuth()
  const { openLogin, openGamePreview } = useUIStore()
  const router = useRouter()
  const reduced = usePrefersReducedMotion()

  const [shuffleNonce, setShuffleNonce] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [drag, setDrag] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<{ id: number; x: number; y: number; axis: 'none' | 'x' } | null>(null)

  // Колода — производное состояние (useMemo), а не state + эффект
  // setDeck(buildDeck()): такая связка циклится, стоит deps сменить ссылку
  const deck = useMemo(() => {
    const base = buildDeck({ games, recentGames, favoriteSlugs, isAuthed: Boolean(user) })
    return shuffleNonce > 0 ? [...base].sort(() => Math.random() - 0.5) : base
  }, [games, recentGames, favoriteSlugs, user, shuffleNonce])

  const remaining = Math.max(0, (catalogTotal ?? 0) - deck.length)
  const showFinale = remaining > 0
  const lastIndex = deck.length + (showFinale ? 1 : 0) - 1
  const isFinale = currentIndex >= deck.length

  if (deck.length === 0) {
    return null
  }

  const go = (to: number): void => setCurrentIndex(clamp(to, 0, Math.max(0, lastIndex)))

  const shuffleDeck = (): void => {
    setShuffleNonce((n) => n + 1)
    setCurrentIndex(0)
  }

  const release = (dx: number): void => {
    const width = boxRef.current?.offsetWidth ?? 320
    if (Math.abs(dx) < width * SWIPE_FRACTION) {
      return
    }
    if (dx > 0) {
      go(currentIndex - 1)
      return
    }
    // Свайп влево с финальной карты ведёт в каталог (§4.4)
    if (isFinale) {
      router.push('/casino')
      return
    }
    go(currentIndex + 1)
  }

  const current = deck[currentIndex]
  if (!current) {
    return null
  }

  const width = boxRef.current?.offsetWidth ?? 320
  const progress = clamp(Math.abs(drag) / (width * SWIPE_FRACTION), 0, 1)
  const tilt = reduced ? 0 : clamp((drag / width) * 36, -MAX_TILT, MAX_TILT)
  const fade = 1 - 0.5 * clamp((Math.abs(drag) - width * 0.5) / (width * 0.5), 0, 1)

  const play = (game: GameDto): void => {
    if (!user) {
      openLogin(game.slug)
      return
    }
    router.push(`/casino/${game.slug}?launch=1`)
  }

  /** «i» на фронт-карте = превью шторкой (матрица жестов §4.4). */
  const preview = (game: GameDto): void => {
    openGamePreview({ game, isFavorite: favoriteSlugs.has(game.slug), onToggleFavorite })
  }

  /** Слой за фронтом: подъезжает к позиции фронта по мере ухода колоды. */
  const layerStyle = (depth: number): React.CSSProperties => {
    if (depth === 0) {
      return {
        transform: `translateX(${drag}px) rotate(${(reduced ? 0 : -3) + tilt}deg)`,
        opacity: fade,
      }
    }
    return {
      transform: `translate(${depth * LAYER_FAN}px, ${
        depth * LAYER_DROP - LAYER_DROP * progress
      }px) scale(${1 - LAYER_SCALE * depth + LAYER_SCALE * progress})`,
      opacity: 1 - 0.26 * depth + 0.12 * progress,
    }
  }

  const easing = reduced
    ? 'opacity 200ms linear'
    : 'transform 330ms cubic-bezier(0.34, 1.4, 0.64, 1), opacity 220ms linear'

  const depths = [0, 1, 2].filter((d) => d === 0 || deck[currentIndex + d] !== undefined)
  const stack = isFinale ? [] : depths

  return (
    <section className="mb-8">
      <DeckHeader
        shown={Math.min(currentIndex + 1, deck.length)}
        total={deck.length}
        onShuffle={shuffleDeck}
      />

      {/* items-center, не items-stretch: очередь выше карточки, и stretch
          ломает aspect-ratio — height становится определённым, и карточка
          на десктопе разъезжается до квадрата. */}
      <div className="flex items-center justify-center gap-4">
        {/* Контейнер стека: слои позиционированы, фронт задаёт размер.
            На десктопе стек не прижимается к центру страницы — он стоит рядом с очередью. */}
        <div
          ref={boxRef}
          tabIndex={0}
          role="group"
          aria-label="Колода слотов"
          className="relative mx-auto aspect-[16/10] w-full max-w-md shrink touch-pan-y select-none sm:aspect-[16/9] lg:mx-0 lg:max-w-2xl"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              go(currentIndex + 1)
            }
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              go(currentIndex - 1)
            }
          }}
          onPointerDown={(e) => {
            gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: 'none' }
          }}
          onPointerMove={(e) => {
            const st = gesture.current
            if (st?.id !== e.pointerId) {
              return
            }
            const dx = e.clientX - st.x
            const dy = e.clientY - st.y
            if (st.axis === 'none') {
              if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
                gesture.current = null
                return
              }
              if (Math.abs(dx) <= 10) {
                return
              }
              st.axis = 'x'
              e.currentTarget.setPointerCapture(e.pointerId)
            }
            setDrag(dx)
          }}
          onPointerUp={(e) => {
            const st = gesture.current
            gesture.current = null
            if (st?.axis === 'x') {
              release(e.clientX - st.x)
            }
            setDrag(0)
          }}
          onPointerCancel={() => {
            gesture.current = null
            setDrag(0)
          }}
        >
          {stack.map((depth) => {
            const card = depth === 0 ? current : deck[currentIndex + depth]
            if (!card) {
              return null
            }
            return (
              <DeckStackCard
                key={card.game.slug}
                card={card}
                front={depth === 0}
                isFavorite={favoriteSlugs.has(card.game.slug)}
                onToggleFavorite={onToggleFavorite}
                onLaunch={play}
                onPreview={preview}
                style={{
                  ...layerStyle(depth),
                  transition: depth === 0 && drag !== 0 ? 'none' : easing,
                  zIndex: stack.length - depth,
                }}
              />
            )
          })}

          {/* Финальная карта колоды (§4.4) */}
          {isFinale && <DeckFinaleCard remaining={remaining} drag={drag} fade={fade} />}
        </div>

        <DeckQueue deck={deck} from={currentIndex + 1} onGo={go} />
      </div>

      <DeckPager total={deck.length} index={currentIndex} lastIndex={lastIndex} onGo={go} />
    </section>
  )
}
