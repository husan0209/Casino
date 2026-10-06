import { Inject, Injectable } from '@nestjs/common'

import {
  CONSENTED_ON_REGISTRATION,
  LEGAL_DOCUMENT_VERSIONS,
  type LegalDocumentType,
} from '@casino/shared-types'

import {
  ListTermsAcceptancesUseCase,
  type TermsAcceptanceStatus,
} from './list-terms-acceptances.use-case'
import { TermsVersionOutdatedError } from '../../domain/errors'
import {
  type ITermsAcceptanceRepository,
  TERMS_ACCEPTANCE_REPOSITORY,
} from '../../domain/repositories/terms-acceptance.repository'

/**
 * Повторный акцепт (GAP-73, Terms §21): после существенных изменений Оператор
 * обязан получить подтверждение заново, а не зачесть молчание как согласие.
 * Вход для этого возвращает флаг `terms_reaccept_required` (login.use-case →
 * этот use-case), игрок подтверждает — и в журнале появляется новая строка на
 * текущую версию.
 *
 * Версия проверяется так же, как при регистрации: сервер записывает то, что
 * считает действующим, и отказывает клиенту, который принёс устаревшую. Иначе
 * «повторный акцепт» можно было бы закрыть кнопкой, отрендеренной по старой
 * редакции текста.
 */
@Injectable()
export class AcceptTermsUseCase {
  constructor(
    @Inject(TERMS_ACCEPTANCE_REPOSITORY) private acceptances: ITermsAcceptanceRepository,
    @Inject(ListTermsAcceptancesUseCase) private list: ListTermsAcceptancesUseCase,
  ) {}

  async execute(input: {
    userId: string
    termsVersion: string
    ip?: string | undefined
    userAgent?: string | undefined
  }): Promise<TermsAcceptanceStatus> {
    if (input.termsVersion !== LEGAL_DOCUMENT_VERSIONS.terms) {
      throw new TermsVersionOutdatedError(LEGAL_DOCUMENT_VERSIONS.terms)
    }

    await this.acceptances.recordMany(
      CONSENTED_ON_REGISTRATION.map((document: LegalDocumentType) => ({
        userId: input.userId,
        document,
        version: LEGAL_DOCUMENT_VERSIONS[document],
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })),
    )

    return this.list.execute(input.userId)
  }
}
