'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import { apiGet } from '@/lib/api'
import { currencyLabel, formatAmount } from '@/lib/format/currency'
import {
  amountDirection,
  EMPTY_TX_FILTER,
  formatTxAmount,
  hasActiveTxParts,
  lockedAmountOf,
  metadataField,
  networkOf,
  parseTxFilter,
  txApiParams,
  txHref,
  txTypeLabel,
  TX_TYPE_LABELS,
  paymentStatusClass,
  paymentStatusLabel,
  type TxFilter,
} from '@/lib/ui/history-filters'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import type { WalletTxListDto, WalletTxDto } from '@/types/wallet-tx'

/**
 * GAP-55 (г) (ТЗ ч.5 §11): история транзакций — отдельный защищённый маршрут,
 * фильтры тип/валюта/период в URL, сумма ВСЕГДА с валютой (§11: «+1 000 без
 * валюты — ошибка UI»), плюс зелёный/минус красный, детали: сеть, внешний id,
 * провайдер. Курс не показываем: при crypto-зачислении он не фиксировался.
 */
const PAGE_SIZE = 25

// Список типов — из единого источника подписей (lib/ui/history-filters),
// чтобы select и таблица не могли разойтись с TX_TYPE_LABELS.
const TX_TYPES = Object.keys(TX_TYPE_LABELS)

const DIRECTION_CLASS: Record<string, string> = {
  in: 'text-[#00C853]',
  out: 'text-[#FF3D71]',
  zero: 'text-muted',
}

export function TransactionsInner(): React.JSX.Element {
  const search = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const { config } = useGeoStore()
  const [openRow, setOpenRow] = useState<string | null>(null)

  const filter: TxFilter = useMemo(() => parseTxFilter(search), [search])

  const apply = useCallback(
    (patch: Partial<TxFilter>): void => {
      router.replace(txHref({ ...EMPTY_TX_FILTER, ...filter, ...patch }))
    },
    [filter, router],
  )

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['wallet-tx', filter.type, filter.currency, filter.from, filter.to],
      queryFn: ({ pageParam }) =>
        apiGet<WalletTxListDto>('/wallet/transactions', {
          page: pageParam,
          per_page: PAGE_SIZE,
          ...txApiParams(filter),
        }),
      enabled: Boolean(user),
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.meta.page < lastPage.meta.total_pages ? lastPage.meta.page + 1 : undefined,
    })

  if (!user) {
    return <div className="container-1 py-8">Войдите в аккаунт</div>
  }

  const rows = data?.pages.flatMap((page) => page.data) ?? []
  const total = data?.pages[0]?.meta.total ?? 0
  const currencies = [
    ...(config?.enabledFiat ?? ['RUB']),
    ...(config?.enabledCrypto ?? ['USDT_TRC20', 'BTC']),
  ]

  return (
    <div className="container-1 py-8">
      <h1 className="mb-4 text-2xl font-bold">История транзакций</h1>

      <div className="card mb-5 flex flex-wrap items-center gap-3">
        <select
          value={filter.type}
          onChange={(e) => apply({ type: e.target.value })}
          className="input w-auto"
          aria-label="Тип операции"
        >
          <option value="">Все типы</option>
          {TX_TYPES.map((type) => (
            <option key={type} value={type}>
              {txTypeLabel(type)}
            </option>
          ))}
        </select>
        <select
          value={filter.currency}
          onChange={(e) => apply({ currency: e.target.value })}
          className="input w-auto"
          aria-label="Валюта"
        >
          <option value="">Все валюты</option>
          {currencies.map((currency) => (
            <option key={currency} value={currency}>
              {currencyLabel(currency)}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filter.from}
          onChange={(e) => apply({ from: e.target.value })}
          className="input w-auto"
          aria-label="С даты"
        />
        <input
          type="date"
          value={filter.to}
          onChange={(e) => apply({ to: e.target.value })}
          className="input w-auto"
          aria-label="По дату"
        />
        {hasActiveTxParts(filter) && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => router.replace('/wallet/transactions')}>
            Сбросить фильтры
          </button>
        )}
        <div className="ml-auto text-sm text-muted">
          {isLoading ? 'Загрузка…' : `${total} записей`}
        </div>
      </div>

      {isError && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-[#FF3D71]/30 bg-[#FF3D71]/5 px-4 py-3 text-sm">
          Не удалось загрузить историю
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => void refetch()}>
            Повторить
          </button>
        </div>
      )}

      {rows.length === 0 && !isLoading ? (
        <div className="py-12 text-center text-sm text-muted">Записей нет</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <TxRow
              key={row.id}
              row={row}
              expanded={openRow === row.id}
              onToggle={() => setOpenRow(openRow === row.id ? null : row.id)}
            />
          ))}
        </ul>
      )}

      {hasNextPage && (
        <div className="mt-6 text-center">
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
          </button>
        </div>
      )}
    </div>
  )
}

function TxRow({
  row,
  expanded,
  onToggle,
}: {
  row: WalletTxDto
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const network = networkOf(row.currency)
  const provider = metadataField(row.metadata, 'provider')
  const externalId = metadataField(row.metadata, 'external_id')
  const locked = lockedAmountOf(row.metadata)
  const statusLabel = paymentStatusLabel(row.payment_status)

  return (
    <li className="card px-4 py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <span className="w-28 shrink-0 text-xs text-muted">
          {new Date(row.created_at).toLocaleDateString('ru')}
        </span>
        <span className="flex-1 truncate text-sm">{txTypeLabel(row.type)}</span>
        <span className={`shrink-0 text-sm font-medium ${DIRECTION_CLASS[amountDirection(row.amount)]}`}>
          {formatTxAmount(row.amount, row.currency)}
        </span>
        <span className="shrink-0 text-xs text-muted">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-1 border-t border-[#2A2A4A] pt-3 text-xs text-muted">
          <Line label="Баланс после" value={formatAmount(row.balance_after, row.currency)} />
          {statusLabel && (
            <div className="flex items-center justify-between gap-3">
              <span>Статус заявки</span>
              <span className={paymentStatusClass(row.payment_status)}>{statusLabel}</span>
            </div>
          )}
          {network && <Line label="Сеть" value={network} />}
          {locked && <Line label="Заморожено" value={formatAmount(locked, row.currency)} />}
          {provider && <Line label="Провайдер" value={provider} />}
          {externalId && <Line label="Внешний id" value={externalId} mono />}
          {row.description && <Line label="Описание" value={row.description} />}
          <Line label="Идентификатор" value={row.transaction_id} mono />
          <p className="pt-1">
            Курс пересчёта не отображается: при крипто-платежах он не фиксировался (ТЗ §11).
          </p>
        </div>
      )}
    </li>
  )
}

function Line({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={mono ? 'font-mono text-white' : 'text-white'}>{value}</span>
    </div>
  )
}
