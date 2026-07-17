'use client'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from '@/components/ui/toaster'

export default function GamePage(){
  const { slug } = useParams() as { slug: string }
  const { user } = useAuth()
  const [currency, setCurrency] = useState('RUB')
  const { data: game } = useQuery({
    queryKey: ['game', slug],
    queryFn: () => apiGet<any>(`/casino/games/${slug}`)
  })
  const launch = useMutation({
    mutationFn: () => apiPost<{launch_url: string; session_id: string}>(`/casino/games/${slug}/launch`, { currency, return_url: window.location.href }),
    onError: (e:any) => toast.error(e?.response?.data?.error?.message || 'Не удалось запустить')
  })
  const demo = useMutation({
    mutationFn: () => apiPost<{launch_url: string}>(`/casino/games/${slug}/demo`, { currency }),
    onSuccess: (res:any) => { window.open(res.launch_url, '_blank') }
  })

  if (!game) return <div className="container-1 py-8">Загрузка…</div>

  return (
    <div className="container-1 py-8">
      <div className="text-sm text-muted mb-2"><Link href="/casino">Каталог</Link> / {game.name_ru || game.name}</div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <div className="aspect-video rounded-xl bg-[#0f0f1a] flex items-center justify-center text-muted">
            {launch.data ? (
              <iframe src={launch.data.launch_url} className="w-full h-full rounded-xl" allow="fullscreen" />
            ) : 'Нажмите "Играть", чтобы запустить'}
          </div>
        </div>
        <div className="card space-y-3 h-fit">
          <h1 className="text-xl font-bold">{game.name_ru || game.name}</h1>
          <div className="text-sm text-muted">{game.provider?.name} • {game.category}</div>
          {game.rtp && <div className="text-sm">RTP: {game.rtp}% {game.volatility && <>• Волатильность: {game.volatility}</>}</div>}
          <div className="flex gap-2 items-center">
            <select value={currency} onChange={e=>setCurrency(e.target.value)} className="input w-auto">
              <option>RUB</option><option>USDT_TRC20</option><option>BTC</option><option>TON</option><option>TRX</option><option>LTC</option>
            </select>
          </div>
          {user ? (
            <button disabled={launch.isPending} onClick={()=>launch.mutate()} className="btn w-full">
              {launch.isPending ? 'Запуск…' : 'Играть на деньги'}
            </button>
          ) : (
            <Link href="/login" className="btn w-full text-center">Войти чтобы играть</Link>
          )}
          {game.has_demo && (
            <button disabled={demo.isPending} onClick={()=>demo.mutate()} className="btn-ghost w-full">
              Демо
            </button>
          )}
          <div className="text-xs text-muted pt-2 border-t border-white/5">
            18+ • Играйте ответственно
          </div>
        </div>
      </div>
    </div>
  )
}
