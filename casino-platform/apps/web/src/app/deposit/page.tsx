'use client'
import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/stores/auth'

export default function DepositPage(){
  const { user } = useAuth()
  const [tab, setTab] = useState<'fiat'|'crypto'>('fiat')
  const [amount, setAmount] = useState('1000')
  const [currency, setCurrency] = useState('USDT_TRC20')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  if (!user) return <div className="container-1 py-8">Войдите в аккаунт</div>

  const submitFiat = async () => {
    setLoading(true)
    try {
      const r = await apiPost('/payments/deposit/fiat', { amount, method: 'card' })
      setResult(r); toast.success('Платёж создан')
    } catch(e:any){ toast.error(e?.response?.data?.error?.message || 'Ошибка') }
    finally { setLoading(false) }
  }
  const submitCrypto = async () => {
    setLoading(true)
    try {
      const r = await apiPost('/payments/deposit/crypto', { amount, currency })
      setResult(r); toast.success('Адрес для оплаты получен')
    } catch(e:any){ toast.error(e?.response?.data?.error?.message || 'Ошибка') }
    finally { setLoading(false) }
  }

  return (
    <div className="container-1 py-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Пополнение</h1>
      <div className="card space-y-4">
        <div className="flex gap-2">
          <button onClick={()=>{setTab('fiat');setResult(null)}} className={tab==='fiat'?'btn text-sm':'btn-ghost text-sm'}>Фиат RUB</button>
          <button onClick={()=>{setTab('crypto');setResult(null)}} className={tab==='crypto'?'btn text-sm':'btn-ghost text-sm'}>Крипто</button>
        </div>
        {tab==='fiat' ? (
          <>
            <input className="input" type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Сумма RUB" />
            <div className="text-xs text-muted">Мин. 100 ₽, макс. 500 000 ₽. KYC лимит 5000 ₽.</div>
            <button disabled={loading} onClick={submitFiat} className="btn w-full">{loading?'…':'Создать платёж (Rukassa)'}</button>
            {result?.payment_url && <a href={result.payment_url} target="_blank" className="btn-ghost w-full text-center block">Перейти к оплате →</a>}
          </>
        ) : (
          <>
            <select className="input" value={currency} onChange={e=>setCurrency(e.target.value)}>
              <option value="USDT_TRC20">USDT TRC20</option>
              <option value="BTC">BTC</option>
              <option value="TON">TON</option>
              <option value="TRX">TRX</option>
              <option value="LTC">LTC</option>
            </select>
            <input className="input" type="number" step="0.00000001" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Сумма" />
            <button disabled={loading} onClick={submitCrypto} className="btn w-full">{loading?'…':'Получить адрес (NOWPayments)'}</button>
            {result?.pay_address && (
              <div className="bg-black/30 rounded-xl p-3 text-sm break-all">
                <div className="text-muted">Отправьте {result.pay_amount} {result.pay_currency?.toUpperCase()} на адрес:</div>
                <div className="font-mono mt-1">{result.pay_address}</div>
                <div className="text-xs text-muted mt-2">Истекает: {new Date(result.expires_at).toLocaleString('ru')}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
