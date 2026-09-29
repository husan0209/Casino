import { SubmitKycUseCase } from '../src/modules/kyc/application/use-cases/submit-kyc.use-case'
import type { IKycRepository } from '../src/modules/kyc/domain/repositories/kyc.repository'

describe('SubmitKycUseCase', () => {
  it('маппит snake_case DTO → KycSubmitInput (даты парсятся, тип документа кастуется)', async () => {
    const calls: unknown[] = []
    const repo = {
      submit: async (input: never) => {
        calls.push(input)
        return { id: 'kyc-1' } as never
      },
    } as unknown as IKycRepository
    const uc = new SubmitKycUseCase(repo)

    const res = await uc.execute({
      userId: 'user-1',
      first_name: 'Иван',
      last_name: 'Иванов',
      date_of_birth: '1990-01-01',
      country: 'RU',
      document_type: 'passport',
      document_number: '1234567890',
      document_expiry: '2030-01-01',
    })

    expect(res).toEqual({ id: 'kyc-1' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      userId: 'user-1',
      firstName: 'Иван',
      lastName: 'Иванов',
      dateOfBirth: new Date('1990-01-01'),
      country: 'RU',
      documentType: 'passport',
      documentNumber: '1234567890',
      documentExpiry: new Date('2030-01-01'),
    })
  })

  it('document_expiry не передан → null (не undefined)', async () => {
    const calls: unknown[] = []
    const repo = {
      submit: async (input: never) => {
        calls.push(input)
        return { id: 'kyc-2' } as never
      },
    } as unknown as IKycRepository
    const uc = new SubmitKycUseCase(repo)

    await uc.execute({
      userId: 'user-2',
      first_name: 'A',
      last_name: 'B',
      date_of_birth: '1990-01-01',
      country: 'RU',
      document_type: 'id_card',
      document_number: 'X',
    })

    expect((calls[0] as { documentExpiry: Date | null }).documentExpiry).toBeNull()
  })
})
