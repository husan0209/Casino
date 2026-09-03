'use client'

interface GameCardProps {
  slug: string
  name: string
  provider: string
  onPlay: () => void
}

export function GameCard({ name, provider, onPlay }: GameCardProps): void {
  return (
    <button
      type="button"
      onClick={onPlay}
      className="card group text-left transition hover:border-[#6C63FF]/40"
    >
      <div className="flex aspect-[4/5] items-center justify-center rounded-xl bg-gradient-to-br from-[#22223a] to-[#111122] text-3xl">
        🎰
      </div>
      <div className="mt-2 truncate text-sm font-medium">{name}</div>
      <div className="truncate text-xs text-muted">{provider}</div>
    </button>
  )
}
