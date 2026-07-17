import { Inject, Injectable } from '@nestjs/common'
import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
import { KycRequiredError } from '../../domain/errors'
@Injectable()
export class KycCheckService {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}
  async assertCanDeposit(userId: string, newDepositRub: number, limitRub = 5000) {
    const status = await this.repo.getStatus(userId)
    if (status?.status === 'approved') return
    const total = parseFloat(await this.repo.getTotalDepositedRub(userId) || '0')
    if (total + newDepositRub > limitRub) throw new KycRequiredError(`Превышен лимит ${limitRub} RUB без KYC. Пройдите верификацию.`)
  }
  async assertCanWithdraw(userId: string) {
    const status = await this.repo.getStatus(userId)
    if (status?.status !== 'approved') throw new KycRequiredError('Вывод средств требует KYC верификации')
  }
}
