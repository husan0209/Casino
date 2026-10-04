import { Inject, Injectable } from '@nestjs/common'

import { LEGAL_DOCUMENT_VERSIONS, type LegalDocumentType } from '@casino/shared-types'

import {
  type ITermsAcceptanceRepository,
  TERMS_ACCEPTANCE_REPOSITORY,
  type TermsAcceptanceView,
} from '../../domain/repositories/terms-acceptance.repository'

export interface TermsAcceptanceStatus {
  /** Все записанные акцепты, свежие первыми (Terms §23 — полная история). */
  accepted: TermsAcceptanceView[]
  /**
   * Какие версии сервер считает действующими. Нужно, чтобы и игрок, и поддержка
   * видели: между последней записью и текущим документом есть разрыв или нет.
   */
  currentVersions: Readonly<Record<LegalDocumentType, string>>
  /** Есть ли хотя бы одна запись по условиям использования — т.е. акцепт доказуем. */
  hasTermsAcceptance: boolean
}

/**
 * Чтение журнала акцепта (GAP-71, Terms §23): игрок вправе получить копию того,
 * что именно он принял, включая версию на дату регистрации.
 */
@Injectable()
export class ListTermsAcceptancesUseCase {
  constructor(
    @Inject(TERMS_ACCEPTANCE_REPOSITORY) private acceptances: ITermsAcceptanceRepository,
  ) {}

  async execute(userId: string): Promise<TermsAcceptanceStatus> {
    const accepted = await this.acceptances.listForUser(userId)
    return {
      accepted,
      currentVersions: LEGAL_DOCUMENT_VERSIONS,
      hasTermsAcceptance: accepted.some((entry) => entry.document === 'terms'),
    }
  }
}
