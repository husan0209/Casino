'use client'
import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/stores/auth'

export default function WithdrawPage(){
  const { user } = useAuth()
  const [amount, setAmount] = useState('500')
  const [currency, setCurrency] = useState('RUB')
  const [address, setAddress] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const url = currency === 'RUB' ? '/payments/withdrawal/fiat' : '/payments/withdrawal/crypto'
      const body = currency === 'RUB'
        ? { amount, method: 'card', destination: { card_number: address, card_holder: 'IVAN PETROV' } }
        : { amount, currency, destination: { wallet_address: address } }
      await apiPost(url, body)
      toast.success('Заявка создана, средства заблокированы')
      setAmount(''); setAddress('')
    } catch(err:any){ toast.error(err?.response?.data?.error?.message || 'Ошибка вывода') }
  }
  if (!user) return <div className="container-1 py-8">Войдите в аккаунт</div>
  return (
    <div className="container-1 py-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-2">Вывод средств</h1>
      <div className="text-sm text-amber-400/80 mb-4 bg-amber-500/5 border border-amber-500/10 rounded-xl px-3 py-2">
        Вывод требует KYC верификации.
      </div>
      <form onSubmit={submit} className="card space-y-3">
        <select className="input" value={currency} onChange={e=>setCurrency(e.target.value)}>
          <option value="RUB">RUB — карта</option>
          <option value="USDT_TRC20">USDT TRC20</option>
          <option value="BTC">BTC</option>
          <option value="TON">TON</option>
          <option value="TRX">TRX</option>
          <option value="LTC">LTC</option>
        </select>
        <input className="input" placeholder="Сумма" value={amount} onChange={e=>setAmount(e.target.value)} required />
        <input className="input" placeholder={currency==='RUB' ? 'Номер карты' : 'Адрес кошелька'} value={address} onChange={e=>setAddress(e.target.value)} required />
        <button className="btn w-full">Создать заявку</button>
        <div className="text-xs text-muted">Мин. вывод: 500 RUB / эквивалент. Средства блокируются до одобрения администратором.</div>
      </form>
    </div>
  )
}
