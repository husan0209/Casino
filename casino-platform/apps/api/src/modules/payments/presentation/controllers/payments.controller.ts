import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { CreateFiatDepositUseCase } from '../../application/use-cases/create-fiat-deposit.use-case'
import { CreateCryptoDepositUseCase } from '../../application/use-cases/create-crypto-deposit.use-case'
import { CreateWithdrawalUseCase } from '../../application/use-cases/create-withdrawal.use-case'
import { CancelWithdrawalUseCase } from '../../application/use-cases/cancel-withdrawal.use-case'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'

@UseGuards(AuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private fiatDep: CreateFiatDepositUseCase,
    private cryptoDep: CreateCryptoDepositUseCase,
    private createWd: CreateWithdrawalUseCase,
    private cancelWd: CancelWithdrawalUseCase,
    private repo: PaymentRequestRepository,
  ) {}
  @Post('deposit/fiat')
  depositFiat(@CurrentUser() u: any, @Body() b: { amount: string; method?: string }) {
    return this.fiatDep.execute(u.id, b.amount, b.method)
  }
  @Post('deposit/crypto')
  depositCrypto(@CurrentUser() u: any, @Body() b: { amount: string; currency: string }) {
    return this.cryptoDep.execute(u.id, b.amount, b.currency)
  }
  @Get('deposit/:id/status')
  async depositStatus(@CurrentUser() u: any, @Param('id') id: string) {
    const pr = await this.repo.findById(id)
    if (!pr || pr.userId !== u.id) throw new Error('NOT_FOUND')
    return pr
  }
  @Post('withdrawal/fiat')
  wdFiat(@CurrentUser() u: any, @Body() b: any) {
    return this.createWd.execute(u.id, { amount: b.amount, currency: 'RUB', method: b.method, destination: b.destination })
  }
  @Post('withdrawal/crypto')
  wdCrypto(@CurrentUser() u: any, @Body() b: any) {
    return this.createWd.execute(u.id, { amount: b.amount, currency: b.currency, destination: b.destination })
  }
  @Get('withdrawals')
  async listWd(@CurrentUser() u: any, @Query() q: any) {
    const page = parseInt(q.page)||1
    const [items,total] = await this.repo.listUser(u.id, 'withdrawal', page, parseInt(q.per_page)||20)
    return { items, meta:{ page, total }}
  }
  @Post('withdrawal/:id/cancel')
  cancel(@CurrentUser() u: any, @Param('id') id: string) {
    return this.cancelWd.execute(u.id, id)
  }
  @Get('exchange-rates')
  async rates() {
    return {
      BTC_RUB: '8500000.00',
      USDT_TRC20_RUB: '92.50',
      TON_RUB: '450.00',
      TRX_RUB: '11.30',
      LTC_RUB: '7800.00',
    }
  }
}
