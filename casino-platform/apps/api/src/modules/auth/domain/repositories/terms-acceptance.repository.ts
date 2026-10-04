import { type LegalDocumentType } from '@casino/shared-types'

/**
 * Журнал акцепта правовых документов (GAP-71).
 *
 * port (domain) + реализация (infrastructure) по конвенции В5: application-слой
 * не знает ни о Prisma, ни о том, в каком виде хранится адрес клиента.
 */
export interface TermsAcceptanceInput {
  userId: string
  document: LegalDocumentType
  version: string
  /**
   * Сырой IP-адрес входа. Реализация обязана сохранить от него необратимый
   * отпечаток (Terms §4 обещает «IP-адрес в необратимом виде»), поэтому тип
   * входа — строка, а поле в БД — хеш.
   */
  ip: string | null
  userAgent: string | null
}

export interface TermsAcceptanceView {
  id: string
  document: LegalDocumentType
  version: string
  acceptedAt: Date
}

export interface ITermsAcceptanceRepository {
  /**
   * Записать акцепт. Повторная запись той же пары (документ × версия) для того
   * же игрока не плодит строк — уникальность по [userId, document, version].
   */
  recordMany(entries: TermsAcceptanceInput[]): Promise<void>
  listForUser(userId: string): Promise<TermsAcceptanceView[]>
}

export const TERMS_ACCEPTANCE_REPOSITORY = Symbol('TERMS_ACCEPTANCE_REPOSITORY')
