import type { Metadata } from 'next'

/**
 * GAP-52 (ТЗ ч.5 §8.1/§20): SEO страницы игры — «{Название} — играть онлайн | Casino».
 * generateMetadata в layout получает params.slug и тянет название из API
 * (клиентская page.tsx не может экспортировать metadata).
 */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'

interface GameApiShape {
  name?: string
  nameRu?: string | null
  provider?: { name?: string } | null
  thumbnailUrl?: string | null
}

async function fetchGameMeta(slug: string): Promise<GameApiShape | null> {
  try {
    const res = await fetch(`${API_URL}/casino/games/${slug}`, { next: { revalidate: 60 } })
    if (!res.ok) {
      return null
    }
    const json = (await res.json()) as { data?: GameApiShape }
    return json.data ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const game = await fetchGameMeta(params.slug)
  const title = game ? (game.nameRu || game.name) : 'Игра'
  const provider = game?.provider?.name ? ` — ${game.provider.name}` : ''
  return {
    title: `${title}${provider} — играть онлайн | Casino`,
    description: `${title}${provider}: RTP, демо и игра на реальные деньги.`,
    openGraph: {
      title: `${title} — играть онлайн | Casino`,
      description: game?.provider?.name ? `Провайдер: ${game.provider.name}` : 'Онлайн слот',
      type: 'website',
    },
  }
}

export default function GameSlugLayout({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return children as React.JSX.Element
}
