import { describe, expect, it, vi } from 'vitest'

import { CONSENTED_ON_REGISTRATION, LEGAL_DOCUMENT_VERSIONS } from '@casino/shared-types'

import { AcceptTermsUseCase } from './accept-terms.use-case'
import { TermsVersionOutdatedError } from '../../domain/errors'

import type { TermsAcceptanceStatus } from './list-terms-acceptances.use-case'
import type {
  ITermsAcceptanceRepository,
  TermsAcceptanceInput,
} from '../../domain/repositories/terms-acceptance.repository'

/**
 * GAP-73 (Terms §21): повторный акцепт обязан (а) не принимать устаревшую
 * версию и (б) возвращать свежий статус — иначе клиент не узнает, что флаг
 * гейта снят, и продолжит показывать диалог.
 */
function makeUc(accepted: TermsAcceptanceStatus['accepted'] = []): {
  uc: AcceptTermsUseCase
  recorded: TermsAcceptanceInput[]
  status: TermsAcceptanceStatus
} {
  const recorded: TermsAcceptanceInput[] = []
  const repo: ITermsAcceptanceRepository = {
    recordMany: async (entries) => {
      recorded.push(...entries)
    },
    listForUser: vi.fn().mockResolvedValue(accepted),
  }
  const status: TermsAcceptanceStatus = {
    accepted,
    currentVersions: LEGAL_DOCUMENT_VERSIONS,
    hasTermsAcceptance: accepted.some((entry) => entry.document === 'terms'),
    reacceptRequired: false,
  }
  const list = { execute: async () => status }
  return { uc: new AcceptTermsUseCase(repo, list as never), recorded, status }
}

describe('AcceptTermsUseCase', () => {
  it('записывает согласие по обоим документам на действующие версии', async () => {
    const { uc, recorded } = makeUc()

    await uc.execute({
      userId: 'u-1',
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    })

    expect(recorded.map((entry) => entry.document).sort()).toEqual(
      [...CONSENTED_ON_REGISTRATION].sort(),
    )
    for (const entry of recorded) {
      expect(entry.userId).toBe('u-1')
      expect(entry.version).toBe(LEGAL_DOCUMENT_VERSIONS[entry.document])
      expect(entry.ip).toBe('203.0.113.7')
      expect(entry.userAgent).toBe('Mozilla/5.0')
    }
  })

  it('устаревшая версия — отказ и ни одной записи', async () => {
    const { uc, recorded } = makeUc()

    await expect(uc.execute({ userId: 'u-1', termsVersion: '0.0-not-current' })).rejects.toThrow(
      TermsVersionOutdatedError,
    )

    expect(recorded).toHaveLength(0)
  })

  it('возвращает свежий статус, чтобы клиент снял гейт', async () => {
    const accepted: TermsAcceptanceStatus['accepted'] = [
      {
        id: 'a-1',
        document: 'terms',
        version: LEGAL_DOCUMENT_VERSIONS.terms,
        acceptedAt: new Date('2026-10-04T12:00:00.000Z'),
      },
    ]
    const { uc, status } = makeUc(accepted)

    const result = await uc.execute({
      userId: 'u-1',
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
    })

    expect(result).toEqual(status)
    expect(result.reacceptRequired).toBe(false)
  })

  it('без ip и user-agent запись всё равно идёт (внутренний вызов)', async () => {
    const { uc, recorded } = makeUc()

    await uc.execute({ userId: 'u-2', termsVersion: LEGAL_DOCUMENT_VERSIONS.terms })

    expect(recorded).toHaveLength(CONSENTED_ON_REGISTRATION.length)
    expect(recorded[0]?.ip).toBeNull()
    expect(recorded[0]?.userAgent).toBeNull()
  })
})
