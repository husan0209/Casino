import { createHash } from 'crypto'

/**
 * Стабильный slug игры каталога: читаемая база + хэш пары (provider, externalId).
 *
 * Правило именования — доменное (переехало из контроллера в рамках В3), а не
 * HTTP-деталь: games.slug имеет @unique, поэтому хэш пары обязателен — иначе
 * две одноимённые игры от разных провайдеров столкнулись бы на одном slug.
 */
export function gameSlug(providerSlug: string, externalGameId: string, name?: string): string {
  const slugBase =
    String(name || externalGameId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'game'
  const hash = createHash('md5')
    .update(`${providerSlug}:${externalGameId}`)
    .digest('hex')
    .slice(0, 6)
  return `${slugBase}-${hash}`
}
