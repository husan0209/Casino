import { Inject, Injectable } from '@nestjs/common'

import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'

interface KycSubmitInput {
  userId: string
  first_name: string
  last_name: string
  date_of_birth: string
  country: string
  document_type: string
}

@Injectable()
export class SubmitKycUseCase {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}
  async execute(input: KycSubmitInput) {
    return this.repo.submit({
      userId: input.userId,
      firstName: input.first_name,
      lastName: input.last_name,
      dateOfBirth: new Date(input.date_of_birth),
      country: input.country,
      documentType: input.document_type,
      documentNumber: input.document_number,
      documentExpiry: input.document_expiry ? new Date(input.document_expiry) : null,
    })
  }
}
