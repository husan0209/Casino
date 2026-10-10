/**
 * Витрина демо-провайдера — единственный источник списка.
 *
 * Чистый модуль без зависимостей (prisma/argon2 остаются в seed.ts), чтобы его
 * можно было проверить тестом на парность с демо-адаптером:
 * apps/api/test/demo-catalog-parity.spec.ts.
 *
 * Десять позиций — ровно столько, сколько показывает колода на главной
 * (`DECK_SIZE` в apps/web/src/components/casino/GameDeck.tsx): колода полная,
 * но не обрезана.
 *
 * Имена вымышленные сознательно: реальные названия реальных слотов под
 * демо-карточками — это чужие товарные знаки в нашем каталоге.
 */
export interface DemoGameSeed {
  slug: string
  name: string
  nameRu: string
  /** Доли, не проценты: колонка `games.rtp` — Decimal(5,2). */
  rtp: number
}

export const DEMO_GAMES: readonly DemoGameSeed[] = [
  { slug: 'demo-sweet-fruits', name: 'Sweet Fruits', nameRu: 'Сладкие фрукты', rtp: 96.5 },
  { slug: 'demo-lucky-sevens', name: 'Lucky Sevens', nameRu: 'Счастливые семёрки', rtp: 96.0 },
  { slug: 'demo-book-of-demo', name: 'Book of Demo', nameRu: 'Книга демо', rtp: 96.21 },
  {
    slug: 'demo-crystal-cascade',
    name: 'Crystal Cascade',
    nameRu: 'Хрустальный каскад',
    rtp: 96.1,
  },
  { slug: 'demo-golden-pharaoh', name: 'Golden Pharaoh', nameRu: 'Золотой фараон', rtp: 95.8 },
  { slug: 'demo-northern-fox', name: 'Northern Fox', nameRu: 'Северная лисица', rtp: 96.4 },
  {
    slug: 'demo-midnight-vault',
    name: 'Midnight Vault',
    nameRu: 'Полуночное хранилище',
    rtp: 95.9,
  },
  { slug: 'demo-sunset-surf', name: 'Sunset Surf', nameRu: 'Закатный сёрф', rtp: 96.3 },
  { slug: 'demo-pirate-reels', name: 'Pirate Reels', nameRu: 'Пиратские барабаны', rtp: 96.05 },
  { slug: 'demo-jungle-bloom', name: 'Jungle Bloom', nameRu: 'Цветение джунглей', rtp: 96.45 },
]
