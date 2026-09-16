'use client'

import Image from 'next/image'

import { parseImageHosts, thumbSource } from '@/lib/ui/thumbnail'

/**
 * GAP-55 (е) (ТЗ §22): обложка игры. Разрешённые CDN идут через next/image
 * (webp/avif, lazy, размер из `sizes`), остальные — обычным lazy-<img>:
 * чужой хост в оптимизаторе = SSRF-вектор, а свой /uploads/ отдаёт nginx.
 * Без обложки — прежняя emoji-заглушка (витрина не пустеет).
 *
 * Список хостов читается из NEXT_PUBLIC_IMAGE_HOSTS на билде (Next инлайнит
 * NEXT_PUBLIC_-переменные), поэтому хелпер остаётся чистой функцией.
 */
const ALLOWED_HOSTS = parseImageHosts(process.env['NEXT_PUBLIC_IMAGE_HOSTS'])

export function GameThumb({
  src,
  alt,
  sizes = '(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 16vw',
}: {
  src?: string | null | undefined
  alt: string
  sizes?: string
}): React.JSX.Element {
  const source = thumbSource(src, ALLOWED_HOSTS)

  if (source.kind === 'next') {
    return (
      <Image
        src={source.src}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
      />
    )
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
  return (
    <span aria-hidden className="text-3xl">
      🎰
    </span>
  )
}
