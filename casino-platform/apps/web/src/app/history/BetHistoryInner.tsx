'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import { apiGet } from '@/lib/api'
import { fetchProviders } from '@/lib/api/casino.api'
import { currencyLabel, formatAmount } from '@/lib/format/currency'
import { gameDisplayName } from '@/lib/ui/game'
import {
  betApiParams,
  betHref,
  EMPTY_BET_FILTER,
  hasActiveBetParts,
  parseBetFilter,
  statsForCurrency,
  totalRounds,
  type BetFilter,
  type BetStatsRow,
} from '@/lib/ui/history-filters'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import type { GameDto, HistoryDto, HistoryRowDto } from '@/types/casino'

import { money } from '@casino/shared-utils'

/**
 * GAP-55 (д) (ТЗ ч.5 §12): история ставок — фильтры игра/провайдер/валюта/период
 * в URL. Наверху НЕ «прибыль/убыток» красным героем: показываем количество ставок,
 * а оборот/выигрыши — только когда выбрана ОДНА валюта (смешанную выборку не
 * суммируем, §12). P/L — в раскрытой детали ставки.
 */
const PAGE_SIZE = 25

export function BetHistoryInner(): React.JSX.Element {
  const search = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const { config } = useGeoStore()
  const [openRound, setOpenRound] = useState<string | null>(null)

  const currencies = [
    ...(config?.enabledFiat ?? ['RUB']),
    ...(config?.enabledCrypto ?? ['USDT_TRC20', 'BTC']),
  ]

  const filter: BetFilter = useMemo(() => parseBetFilter(search), [search])

  const apply = useCallback(
    (patch: Partial<BetFilter>): void => {
      router.replace(betHref({ ...EMPTY_BET_FILTER, ...filter, ...patch }))
    },
    [filter, router],
  )

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: [
      'bet-history',
      filter.gameId,
      filter.provider,
      filter.currency,
      filter.from,
      filter.to,
    ],
    queryFn: ({ pageParam }) =>
      apiGet<HistoryDto>('/casino/history', {
        page: pageParam,
        per_page: PAGE_SIZE,
        ...betApiParams(filter),
      }),
    enabled: Boolean(user),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.total_pages ? lastPage.meta.page + 1 : undefined,
  })

  const { data: providers } = useQuery({
    queryKey: ['providers-page'],
    queryFn: () => fetchProviders(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: games } = useQuery({
    queryKey: ['games-for-filter'],
    queryFn: () => apiGet<{ data: GameDto[] }>('/casino/games', { per_page: 100 }),
    staleTime: 5 * 60 * 1000,
  })

  const rows: HistoryRowDto[] = data?.pages.flatMap((page) => page.data) ?? []
  // HistoryStatsDto и BetStatsRow структурно идентичны: деньги приходят со бэка
  // строками, маппинг не нужен (и не появятся number в деньгах).
  const stats: BetStatsRow[] = data?.pages[0]?.stats ?? []
  const singleCurrencyStats = statsForCurrency(stats, filter.currency)

  return (
    <div className="container-1 py-8">
      <h1 className="mb-4 text-2xl font-bold">История ставок</h1>

      <div className="card mb-5 flex flex-wrap items-center gap-3">
        <select
          value={filter.gameId}
          onChange={(e) => apply({ gameId: e.target.value })}
          className="input w-auto max-w-[220px]"
          aria-label="Игра"
        >
          <option value="">Все игры</option>
          {(games?.data ?? []).map((game) => (
            <option key={game.id} value={game.id}>
              {gameDisplayName(game)}
            </option>
          ))}
        </select>
        <select
          value={filter.provider}
          onChange={(e) => apply({ provider: e.target.value })}
          className="input w-auto"
          aria-label="Провайдер"
        >
          <option value="">Все провайдеры</option>
          {(providers ?? []).map((provider) => (
            <option key={provider.slug} value={provider.slug}>
              {provider.name}
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
        {hasActiveBetParts(filter) && (
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => router.replace('/history')}
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      <div className="mb-5 flex flex-wrap gap-4 text-sm">
        <div className="card flex-1 px-4 py-3">
          <div className="text-xs text-muted">Ставок</div>
          <div className="text-lg font-semibold">{isLoading ? '…' : totalRounds(stats)}</div>
        </div>
        {singleCurrencyStats ? (
          <>
            <div className="card flex-1 px-4 py-3">
              <div className="text-xs text-muted">Оборот</div>
              <div className="text-lg font-semibold">
                {formatAmount(singleCurrencyStats.turnover, singleCurrencyStats.currency)}
              </div>
            </div>
            <div className="card flex-1 px-4 py-3">
              <div className="text-xs text-muted">Выигрыши</div>
              <div className="text-lg font-semibold text-[#00C853]">
                {formatAmount(singleCurrencyStats.wins, singleCurrencyStats.currency)}
              </div>
            </div>
          </>
        ) : (
          <div className="card flex-1 px-4 py-3">
            <div className="text-xs text-muted">
              Оборот и выигрыши — по валютам (₽ и USDT не суммируем). Выберите одну валюту.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {stats.map((row) => (
                <button
                  key={row.currency}
                  type="button"
                  className="rounded-lg border border-[#2A2A4A] px-2 py-1 text-xs hover:border-[#6C63FF]/40"
                  onClick={() => apply({ currency: row.currency })}
                >
                  {currencyLabel(row.currency)}: {formatAmount(row.turnover, row.currency)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {rows.length === 0 && !isLoading ? (
        <div className="py-12 text-center text-sm text-muted">Ставок в этом периоде нет</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <BetRow
              key={row.round_id}
              row={row}
              expanded={openRound === row.round_id}
              onToggle={() =>
                setOpenRound(openRound === row.round_id ? null : row.round_id)
              }
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

/**
 * Строка ставки: игра, валюта, ставка, выигрыш, дата. P/L — только в детали
 * (§12: «прибыль/убыток» не героем страницы).
 */
function BetRow({
  row,
  expanded,
  onToggle,
}: {
  row: HistoryRowDto
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const profit = money.subtract(row.total_win, row.total_bet)

  return (
    <li className="card px-4 py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <span className="w-28 shrink-0 text-xs text-muted">
          {new Date(row.created_at).toLocaleDateString('ru')}
        </span>
        <span className="flex-1 truncate text-sm">{row.game.name}</span>
        <span className="shrink-0 text-xs text-muted">{currencyLabel(row.currency)}</span>
        <span className="shrink-0 text-sm">{formatAmount(row.total_bet, row.currency)}</span>
        <span className="shrink-0 text-sm text-[#00C853]">
          {formatAmount(row.total_win, row.currency)}
        </span>
        <span className="shrink-0 text-xs text-muted">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-1 border-t border-[#2A2A4A] pt-3 text-xs text-muted">
          <div className="flex justify-between gap-3">
            <span>Провайдер</span>
            <span className="text-white">{row.game.provider}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Статус раунда</span>
            <span className="text-white">{row.status}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Разница по ставке</span>
            <span className={money.isPositive(profit) ? 'text-[#00C853]' : 'text-[#FF3D71]'}>
              {formatAmount(profit, row.currency)}
            </span>
          </div>
        </div>
      )}
    </li>
  )
}
