export interface KycSubmitInput {
  userId: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  country: string
  documentType: 'passport' | 'id_card' | 'drivers_license'
  documentNumber: string
  documentExpiry?: Date | null
}
/** Read-модель KYC-профиля живёт в @casino/shared-types (В4); тут реэкспорт
 *  для внутренних потребителей домена/application. */
import type { KycProfileRow } from '@casino/shared-types'

export type { KycProfileRow }

/**
 * Одна посчитанная заявка на вывод. `amountRub` — то, что записано в заявку
 * (для новых выводов — RUB-эквивалент на интенте); `null` у строк, созданных
 * до того, как колонку стали заполнять, — их вызывающий переводит сам по
 * `currency` + `amount`.
 */
export interface CountedWithdrawal {
  currency: string
  amount: string
  amountRub: string | null
}
export interface IKycRepository {
  getByUserId(userId: string): Promise<KycProfileRow | null>
  getById(id: string): Promise<KycProfileRow | null>
  submit(input: KycSubmitInput): Promise<KycProfileRow>
  addDocument(
    kycProfileId: string,
    doc: {
      documentType: string
      fileUrl: string
      fileName?: string
      fileSize?: number
      mimeType?: string
    },
  ): Promise<void>
  getStatus(userId: string): Promise<{
    status: string
    submittedAt: Date | null
    rejectionReason: string | null
    documents: string[]
  } | null>
  listAdmin(
    status?: string,
    page?: number,
    perPage?: number,
  ): Promise<{ items: KycProfileRow[]; total: number }>
  setStatus(args: {
    id: string
    status: 'approved' | 'rejected' | 'requires_resubmission'
    reason?: string
    reviewedBy?: string
  }): Promise<void>
  getTotalDepositedRub(userId: string): Promise<string>
  /**
   * Выводы игрока, которые уже считаются: `pending` (ждёт подтверждения
   * оператором, баланс заморожен), `processing` и `completed`. `failed`,
   * `cancelled` и `expired` не входят — эти деньги игроку не отдали, и
   * учитывать их значит наказывать за чужую ошибку провайдера.
   *
   * Отдаются строки, а не сумма: `amount_rub` у заявок на вывод исторически
   * пустой (колонку пишут только депозиты), поэтому перевод в рубли — дело
   * вызывающего, у которого есть GeoFacade. Список одного игрока ограничен
   * сверху тем же порогом, ради которого всё считается.
   */
  listCountedWithdrawals(userId: string): Promise<CountedWithdrawal[]>
}
export const KYC_REPOSITORY = Symbol('KYC_REPOSITORY')
