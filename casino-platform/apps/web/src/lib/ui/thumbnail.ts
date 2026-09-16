/**
 * GAP-55 (е) (ТЗ ч.5 §22): обложки игр. next/image даёт webp/avif, blur и
 * lazy-загрузку, но принимает только хосты из allowlist (см. next.config.js).
 * Прочие https-ссылки (и относительные /uploads/…) рендерим обычным
 * <img loading="lazy"> — картинка остаётся картинкой, оптимизатор её не трогает.
 *
 * Чистая функция, чтобы выбор источника был покрыт тестами, а не «на глаз»
 * в компоненте (конвенция GAP-44).
 */

export type ThumbSource =
  | { kind: 'next'; src: string }
  | { kind: 'raw'; src: string }
  | { kind: 'none' }

export function parseImageHosts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
}

export function isAllowedImageHost(url: string, hosts: string[]): boolean {
  let host: string
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return false
  }
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/**
 * Относительные пути (/uploads/…) — это nginx-статик, НЕ файлы Next-ового
 * public/: через /_next/image такой URL не резолвится (404), поэтому он идёт
 * обычным <img>, а не next/image.
 */
function isLocalStatic(url: string): boolean {
  return url.startsWith('/')
}

export function thumbSource(
  url: string | null | undefined,
  hosts: string[],
): ThumbSource {
  const trimmed = url?.trim() ?? ''
  if (trimmed.length === 0) {
    return { kind: 'none' }
  }
  if (isLocalStatic(trimmed)) {
    return { kind: 'raw', src: trimmed }
  }
  return isAllowedImageHost(trimmed, hosts)
    ? { kind: 'next', src: trimmed }
    : { kind: 'raw', src: trimmed }
}
