'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'
import { apiGetFull } from '@/lib/api'

interface LedgerRow {
  id: string
  createdAt: string
  type: string
  amount: string
  description: string | null
  user?: { email: string | null }
  walletAccount?: { currency: string }
}
const POSITIVE = new Set([
  'DEPOSIT',
  'WIN',
  'ADMIN_CREDIT',
  'REFERRAL_REWARD',
  'WITHDRAWAL_UNLOCK',
  'ROLLBACK',
])

export default function TransactionsPage() {
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['tx', page, type],
    queryFn: () =>
      apiGetFull<LedgerRow[]>('/admin/transactions', {
        page,
        per_page: 30,
        type: type || undefined,
      }),
    refetchInterval: 15000,
  })

  return (
    <div>
      <PageTitle>Транзакции (ledger)</PageTitle>
      <div className="flex gap-3 mb-4">
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value)
            setPage(1)
          }}
          className="w-56"
        >
          <option value="">Все типы</option>
          {[
            'DEPOSIT',
            'WITHDRAWAL',
            'WITHDRAWAL_LOCK',
            'WITHDRAWAL_UNLOCK',
            'WITHDRAWAL_CONFIRM',
            'BET',
            'WIN',
            'ROLLBACK',
            'ADMIN_CREDIT',
            'ADMIN_DEBIT',
            'REFERRAL_REWARD',
          ].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <Loading />}
      {data?.data && (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Дата</Th>
                <Th>Пользователь</Th>
                <Th>Тип</Th>
                <Th>Сумма</Th>
                <Th>Валюта</Th>
                <Th>Описание</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((t) => {
                const plus = POSITIVE.has(t.type)
                return (
                  <tr key={t.id}>
                    <Td className="text-[#8b8ba7] whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleString('ru-RU')}
                    </Td>
                    <Td>{t.user?.email ?? '—'}</Td>
                    <Td>
                      <Badge value={t.type} />
                    </Td>
                    <Td className={`font-mono ${plus ? 'text-emerald-400' : 'text-red-400'}`}>
                      {plus ? '+' : '−'}
                      {Number(t.amount).toLocaleString('ru-RU')}
                    </Td>
                    <Td className="text-[#8b8ba7]">{t.walletAccount?.currency ?? ''}</Td>
                    <Td className="text-[#8b8ba7] max-w-xs truncate">{t.description ?? ''}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pager page={page} perPage={30} total={data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  )
}
