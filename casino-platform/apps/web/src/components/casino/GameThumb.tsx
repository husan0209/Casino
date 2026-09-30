'use client'

import Image from 'next/image'

import { parseImageHosts, thumbSource } from '@/lib/ui/thumbnail'

/**
 * GAP-55 (е) (ТЗ §22): обложка игры. Разрешённые CDN идут через next/image
 * (webp/avif, lazy, размер из `sizes`), остальные — обычным lazy-<img>:
 * чужой хост в оптимизаторе = SSRF-вектор, а свой /uploads/ отдаёт nginx.
 *
 * Без обложки рисуется детерминированная плашка (ТЗ ч.5.1 §4.5: витрина не
 * пустеет) — цвет зависит от имени, поэтому одна игра всегда выглядит
 * одинаково, а сетка карточек не сливается в серое пятно.
 *
 * Список хостов читается из NEXT_PUBLIC_IMAGE_HOSTS на билде (Next инлайнит
 * NEXT_PUBLIC_-переменные), поэтому хелпер остаётся чистой функцией.
 */
const ALLOWED_HOSTS = parseImageHosts(process.env['NEXT_PUBLIC_IMAGE_HOSTS'])

/** Пары градиентов fallback-обложек. Зелёного нет: он зарезервирован за деньгами (§2.4). */
const COVER_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#6C63FF', '#2A1E63'],
  ['#00D2FF', '#123A6B'],
  ['#FF3D71', '#4A1338'],
  ['#FFB300', '#5A3208'],
  ['#8B7FFF', '#2F2270'],
  ['#C86969', '#3A1D3A'],
]

function coverStyle(seed: string): React.CSSProperties {
  let hash = 0
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100_000
  }
  const [from, to] = COVER_GRADIENTS[hash % COVER_GRADIENTS.length] as readonly [string, string]
  return { backgroundImage: `linear-gradient(140deg, ${from} 0%, ${to} 78%)` }
}

function initials(name: string): string {
  return (
    name
      .split(/[\s:,-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase() || '★'
  )
}

/** Обложка без картинки: имя игры приходит обязательным параметром. */
function CoverArt({ name }: { name: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={coverStyle(name)}
    >
      {/* барабаны: три вертикальные линии читаются как слот, а не как абстракция */}
      <span className="absolute inset-y-0 left-1/3 w-px bg-white/10" />
      <span className="absolute inset-y-0 right-1/3 w-px bg-white/10" />
      <span className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-white/10" />
      <span className="relative text-2xl font-extrabold tracking-tight text-white/90 drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]">
        {initials(name)}
      </span>
    </span>
  )
}

export function GameThumb({
  src,
  alt,
  seed,
  sizes = '(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 16vw',
}: {
  src?: string | null | undefined
  alt: string
  /** Стабилизирует цвет fallback-обложки: декоративные каверы передают slug, а не пустой alt. */
  seed?: string | undefined
  sizes?: string
}): React.JSX.Element {
  const source = thumbSource(src, ALLOWED_HOSTS)

  if (source.kind === 'next') {
    return <Image src={source.src} alt={alt} fill sizes={sizes} className="object-cover" />
  }
  if (source.kind === 'raw') {
    return (
      <img
        src={source.src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    )
  }
  return <CoverArt name={seed ?? alt} />
}
