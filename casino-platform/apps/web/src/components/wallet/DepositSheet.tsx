'use client'
import { useEffect, useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { saveDepositContext } from '@/components/wallet/DepositReturnHandler'
import { errText } from '@/lib/api'
import { createFiatDeposit } from '@/lib/api/wallet.api'
import { formatAmount } from '@/lib/format/currency'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

export function DepositSheet() {
  const { depositSheet, closeDeposit, depositCurrency, pendingGameSlug } = useUIStore()
  const { config, load } = useGeoStore()
  const { activeCurrency, setActiveCurrency } = useWalletStore()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCrypto, setShowCrypto] = useState(false)
  const [mode, setMode] = useState<'fiat' | 'crypto'>('fiat')

  const currency = depositCurrency || config?.activeCurrency || activeCurrency

  useEffect(() => {
    if (depositSheet) void load()
  }, [depositSheet, load])

  useEffect(() => {
    if (!depositSheet) return
    setMode('fiat')
    setShowCrypto(false)
    if (config?.paymentMethods[0]) setMethod(config.paymentMethods[0].id)
  }, [config, depositSheet])

  if (!depositSheet) return null

  const presets = config?.depositPresets ?? ['1000', '2000', '5000', '10000']
  const fiatMethods = config?.paymentMethods ?? []
  const cryptoMethods = config?.cryptoMethods ?? []
  const payCurrency = mode === 'crypto' && cryptoMethods[0] ? cryptoMethods.find((m) => m.id === method)?.currency ?? 'USDT_TRC20' : currency

  const currencyLabel = formatAmount(0, payCurrency).replace(/^0\s?/, '').trim() || payCurrency

  const pay = async () => {
    if (!amount || !method) return
    setLoading(true)
    try {
      await setActiveCurrency(payCurrency)
      const res = await createFiatDeposit({ amount, currency: payCurrency, method })
      if (res.payment_url) {
        if (res.payment_request_id) {
          saveDepositContext(res.payment_request_id, pendingGameSlug)
        }
        window.location.href = res.payment_url
      } else {
        toast.error('Не получен URL оплаты')
      }
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setLoading(false)
    }
  }

  const openCrypto = () => {
    setMode('crypto')
    setShowCrypto(true)
    if (cryptoMethods[0]) setMethod(cryptoMethods[0].id)
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={closeDeposit} />
      <div className="sheet-panel">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Пополнить {currencyLabel}</h2>
          <button type="button" onClick={closeDeposit} className="text-muted">✕</button>
        </div>

        {mode === 'fiat' && (
          <div className="mt-4 space-y-2">
            {fiatMethods.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${method === m.id ? 'border-[#6C63FF] bg-white/5' : 'border-[#2A2A4A]'}`}
              >
                {m.label}
              </button>
            ))}
            {cryptoMethods.length > 0 && !showCrypto && (
              <button type="button" className="btn-ghost w-full text-sm" onClick={openCrypto}>
                Ещё способы
              </button>
            )}
          </div>
        )}

        {mode === 'crypto' && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-muted">Только USDT · TRC20 или BTC</p>
            {cryptoMethods.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${method === m.id ? 'border-[#6C63FF] bg-white/5' : 'border-[#2A2A4A]'}`}
              >
                {m.label}
              </button>
            ))}
            <button type="button" className="text-sm text-muted" onClick={() => { setMode('fiat'); setShowCrypto(false) }}>
              ← Фиат
            </button>
          </div>
        )}

        <div className="mt-4">
          <label className="text-sm text-muted">Сумма</label>
          <input className="input mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000" />
          <div className="mt-2 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p} type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setAmount(p)}>
                {formatAmount(p, payCurrency, true)}
              </button>
            ))}
          </div>
          {config?.depositMin && mode === 'fiat' && (
            <p className="mt-2 text-xs text-muted">Минимум {formatAmount(config.depositMin, payCurrency, true)}</p>
          )}
        </div>

        <button type="button" className="btn-money mt-5 w-full" disabled={loading} onClick={pay}>
          {loading ? 'Переход к оплате…' : 'Пополнить'}
        </button>

        {pendingGameSlug && (
          <p className="mt-2 text-center text-xs text-muted">После оплаты — вернётесь в игру</p>
        )}
      </div>
    </>
  )
}
