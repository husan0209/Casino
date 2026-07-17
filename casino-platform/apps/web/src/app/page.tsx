'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'

export default function Home(){
  const { data } = useQuery({
    queryKey: ['games-home'],
    queryFn: () => apiGet<any>('/casino/games?per_page=12&sort=popular'),
    retry: false,
  })
  const games = (data?.data || data || []) as any[]
  const fallback = [
    { slug:'demo-sweet-fruits', name:'Sweet Fruits', provider:{name:'Demo'}, rtp:96.5 },
    { slug:'demo-lucky-sevens', name:'Lucky Sevens', provider:{name:'Demo'}, rtp:96 },
    { slug:'demo-book-of-demo', name:'Book of Demo', provider:{name:'Demo'}, rtp:96.2 },
  ]
  const list = games.length ? games : fallback
  return (
    <div className="container-1 py-8">
      <section className="card rounded-2xl p-8 mb-10 bg-gradient-to-br from-surface to-surface2 border-white/10">
        <h1 className="text-3xl sm:text-4xl font-extrabold">Premium Dark Casino</h1>
        <p className="text-muted mt-2 max-w-xl">NestJS + Next.js • Rukassa • NOWPayments • KYC 5000₽ • GGR-share рефералы</p>
        <div className="mt-5 flex gap-3">
          <Link href="/casino" className="btn">Каталог игр</Link>
          <Link href="/register" className="btn-ghost">Создать аккаунт</Link>
        </div>
      </section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Популярные</h2>
        <Link href="/casino" className="text-sm text-muted hover:text-white">Все игры →</Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {list.slice(0,12).map((g:any,i:number)=>(
          <Link key={g.slug || i} href={`/casino/${g.slug}`} className="card hover:border-brand/30 transition group">
            <div className="aspect-[4/5] rounded-xl bg-gradient-to-br from-[#22223a] to-[#111122] flex items-center justify-center text-muted group-hover:text-white text-2xl">🎰</div>
            <div className="mt-3 text-sm font-medium truncate">{g.name_ru || g.name}</div>
            <div className="text-xs text-muted">{g.provider?.name || 'Demo'}{g.rtp ? ` • RTP ${g.rtp}%` : ''}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
