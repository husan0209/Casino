import type { Metadata } from 'next'

/**
 * GAP-53 (ТЗ ч.5 §20): SEO страницы провайдера —
 * «{Название} — игры провайдера | Casino». Данные тянутся из API
 * (клиентская page.tsx не может экспортировать metadata).
 */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'

interface ProviderApiShape {
  slug?: string
  name?: string
  game_count?: number
}

async function fetchProviderMeta(slug: string): Promise<ProviderApiShape | null> {
  try {
    const res = await fetch(`${API_URL}/casino/providers`, { next: { revalidate: 300 } })
    if (!res.ok) {
      return null
    }
    const json = (await res.json()) as { data?: ProviderApiShape[] }
    return json.data?.find((p) => p.slug === slug) ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const provider = await fetchProviderMeta(params.slug)
  const name = provider?.name ?? params.slug
  const count = provider?.game_count ? ` (${provider.game_count} игр)` : ''
  return {
    title: `${name} — игры провайдера | Casino`,
    description: `Слоты провайдера ${name}: играть онлайн${count}.`,
    openGraph: {
      title: `${name} — игры провайдера | Casino`,
      description: `Слоты провайдера ${name}: играть онлайн`,
      type: 'website',
    },
  }
}

export default function ProviderSlugLayout({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return children as React.JSX.Element
}
