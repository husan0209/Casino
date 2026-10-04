import { describe, expect, it, vi } from 'vitest'

import { LEGAL_DOCUMENT_VERSIONS } from '@casino/shared-types'

import { ListTermsAcceptancesUseCase } from './list-terms-acceptances.use-case'

import type {
  ITermsAcceptanceRepository,
  TermsAcceptanceView,
} from '../../domain/repositories/terms-acceptance.repository'

/**
 * GAP-71: журнал акцепта должен читаться так, как его описывает Terms §23 —
 * полная история плюс действующие версии, чтобы было видно разрыв между
 * последней записью игрока и текущим текстом документа.
 */
function makeUc(accepted: TermsAcceptanceView[] = []): {
  uc: ListTermsAcceptancesUseCase
  repo: ITermsAcceptanceRepository
} {
  const repo: ITermsAcceptanceRepository = {
    listForUser: vi.fn().mockResolvedValue(accepted),
    recordMany: vi.fn(),
  }
  return { uc: new ListTermsAcceptancesUseCase(repo), repo }
}

describe('ListTermsAcceptancesUseCase', () => {
  it('возвращает историю и действующие версии реестра', async () => {
    const accepted: TermsAcceptanceView[] = [
      {
        id: 'a1',
        document: 'privacy',
        version: '1.0',
        acceptedAt: new Date('2026-10-04T10:00:00Z'),
      },
      { id: 'a2', document: 'terms', version: '1.0', acceptedAt: new Date('2026-10-04T10:00:00Z') },
    ]
    const { uc, repo } = makeUc(accepted)

    const result = await uc.execute('u1')

    expect(repo.listForUser).toHaveBeenCalledWith('u1')
    expect(result.accepted).toEqual(accepted)
    expect(result.currentVersions).toEqual(LEGAL_DOCUMENT_VERSIONS)
  })

  it('hasTermsAcceptance — только про условия использования, не про любой документ', async () => {
    const withoutTerms = makeUc([
      { id: 'a1', document: 'privacy', version: '1.0', acceptedAt: new Date() },
    ])
    const withTerms = makeUc([
      { id: 'a2', document: 'terms', version: '0.9', acceptedAt: new Date() },
    ])

    expect((await withoutTerms.uc.execute('u1')).hasTermsAcceptance).toBe(false)
    // Устаревшая версия всё ещё является акцептом: разрыв показывает
    // сравнение version и currentVersions, а не пропажа записи.
    expect((await withTerms.uc.execute('u2')).hasTermsAcceptance).toBe(true)
  })

  it('пустой журнал — не ошибка, а доказательство отсутствия акцепта', async () => {
    const { uc } = makeUc([])

    const result = await uc.execute('u1')

    expect(result.accepted).toEqual([])
    expect(result.hasTermsAcceptance).toBe(false)
  })
})
