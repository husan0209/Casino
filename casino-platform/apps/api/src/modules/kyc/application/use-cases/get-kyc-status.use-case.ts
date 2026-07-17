import { Inject, Injectable } from '@nestjs/common'
import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
@Injectable()
export class GetKycStatusUseCase {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}
  execute(userId: string) { return this.repo.getStatus(userId) }
}
