import { Inject, Injectable } from '@nestjs/common'

import { money } from '@casino/shared-utils'

import { KycRequiredError } from '../../domain/errors'
import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'

@Injectable()
export class KycCheckService {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}
  async assertCanDeposit(userId: string, newDepositRub: string, limitRub = '5000'): Promise<void> {
    const status = await this.repo.getStatus(userId)
    if (status?.status === 'approved') {
      return
    }
    const total = (await this.repo.getTotalDepositedRub(userId)) || '0'
    if (money.isGreaterThan(money.add(total, newDepositRub), limitRub)) {
      throw new KycRequiredError(`Превышен лимит ${limitRub} RUB без KYC. Пройдите верификацию.`)
    }
  }
  async assertCanWithdraw(userId: string): Promise<void> {
    const status = await this.repo.getStatus(userId)
    if (status?.status !== 'approved') {
      throw new KycRequiredError('Вывод средств требует KYC верификации')
    }
  }
}
