'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import Link from 'next/link'
import { useState } from 'react'
export default function CasinoPage(){
  const [category, setCategory] = useState('')
  const [provider, setProvider] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['games', category, provider, search, page],
    queryFn: () => apiGet<any>('/casino/games', { page, per_page: 24, category: category || undefined, provider: provider || undefined, search: search || undefined }),
  })
  const games = data?.data || []
  const meta = data?.meta
  const { data: providers } = useQuery({ queryKey:['providers'], queryFn: ()=>apiGet<any>('/casino/providers'), staleTime: 5*60*1000 })
  const provList:any[] = Array.isArray(providers) ? providers : providers?.data || []
  return (
    <div className="container-1 py-8">
      <h1 className="text-2xl font-bold mb-4">Каталог игр</h1>
      <div className="card mb-5 flex flex-wrap gap-3 items-center">
        <select value={category} onChange={e=>{setCategory(e.target.value); setPage(1)}} className="input w-auto">
          <option value="">Все категории</option>
          <option value="slots">Слоты</option>
          <option value="live_casino">Live Казино</option>
          <option value="table_games">Настольные</option>
          <option value="instant_games">Быстрые</option>
        </select>
        <select value={provider} onChange={e=>{setProvider(e.target.value); setPage(1)}} className="input w-auto">
          <option value="">Все провайдеры</option>
          {provList.map((p:any)=><option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
        <input placeholder="Поиск…" value={search} onChange={e=>{setSearch(e.target.value); setPage(1)}} className="input w-56" />
        <div className="text-sm text-muted ml-auto">{isLoading ? 'Загрузка…' : `${meta?.total ?? games.length} игр`}</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {games.map((g:any)=>(
          <Link key={g.slug} href={`/casino/${g.slug}`} className="card hover:border-brand/30 transition group">
            <div className="aspect-[4/5] rounded-xl bg-gradient-to-br from-[#22223a] to-[#111122] flex items-center justify-center text-muted group-hover:text-white text-3xl">🎰</div>
            <div className="mt-3 text-sm font-medium truncate" title={g.name_ru || g.name}>{g.name_ru || g.name}</div>
            <div className="text-xs text-muted">{g.provider?.name}{g.rtp ? ` • ${g.rtp}%`:''}</div>
            <div className="text-xs mt-1">{g.is_new && <span className="badge">NEW</span>} {g.is_popular && <span className="badge ml-1">TOP</span>}</div>
          </Link>
        ))}
      </div>
      {meta && meta.totalPages > 1 && (
        <div className="flex gap-2 justify-center mt-6">
          <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="btn-ghost text-sm disabled:opacity-30">← Назад</button>
          <span className="text-sm text-muted px-3 py-2">{page} / {meta.totalPages}</span>
          <button disabled={!meta.hasNext} onClick={()=>setPage(p=>p+1)} className="btn-ghost text-sm disabled:opacity-30">Вперёд →</button>
        </div>
      )}
      {!isLoading && games.length===0 && <div className="text-muted text-center py-12">Ничего не найдено</div>}
    </div>
  )
}
