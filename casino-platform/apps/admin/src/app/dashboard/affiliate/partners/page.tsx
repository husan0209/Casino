'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Btn, Card, Input, Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'
import { apiGetFull } from '@/lib/api'
import { type AdminAffiliateDto } from '@/types/affiliate'

/**
 * Список партнёров.
 *
 * Поиск и фильтр по статусу обязательны: при 50+ партнёрах карточка конкретного
 * партнёра иначе находится только перебором. Ставка вынесена в отдельную
 * колонку, чтобы разброс индивидуальных ставок был виден сразу.
 */
export default function AffiliatePartnersPage(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const perPage = 20

  const list = useQuery({
    queryKey: ['aff-partners', page, status, search],
    queryFn: () =>
      apiGetFull<AdminAffiliateDto[]>('/admin/affiliate/partners', {
        page,
        per_page: perPage,
        ...(status !== '' ? { status } : {}),
        ...(search.trim() !== '' ? { search: search.trim() } : {}),
      }),
  })

  return (
    <div>
      <PageTitle>Партнёры</PageTitle>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          small
          placeholder="Поиск по email, имени или коду"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          className="max-w-[180px]"
        >
          <option value="">Все статусы</option>
          <option value="active">Активные</option>
          <option value="suspended">Приостановленные</option>
          <option value="rejected">Отклонённые</option>
        </Select>
        <Btn
          small
          variant="ghost"
          onClick={() => {
            setSearch('')
            setStatus('')
            setPage(1)
          }}
        >
          Сбросить
        </Btn>
      </div>

      {list.isLoading && <Loading />}

      {list.data !== undefined && (
        <>
          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Код</Th>
                  <Th>Ставка</Th>
                  <Th>Заработано</Th>
                  <Th>Статус</Th>
                  <Th>Регистрация</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((partner) => (
                  <tr key={partner.id}>
                    <Td>
                      <a
                        href={`/dashboard/affiliate/partners/${partner.id}`}
                        className="text-[#ff3b7a] hover:underline"
                      >
                        {partner.email}
                      </a>
                    </Td>
                    <Td className="font-mono text-xs">{partner.tracking_code}</Td>
                    <Td className="font-mono">
                      {(Number(partner.revshare_rate) * 100).toFixed(1)}%
                    </Td>
                    <Td className="font-mono">
                      {Number(partner.total_earned).toLocaleString('ru-RU', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Td>
                    <Td>
                      <Badge value={partner.status} />
                    </Td>
                    <Td className="text-[#8b8ba7] text-xs">{partner.created_at.slice(0, 10)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data.data.length === 0 && (
              <div className="text-[#8b8ba7] text-sm py-4">Партнёров не найдено</div>
            )}
          </Card>
          <Pager
            page={page}
            perPage={perPage}
            total={list.data.meta?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}
    </div>
  )
}
