import { Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type UserActor } from '@/common/types/req-user'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'

import { type PaymentStatus } from '@casino/database'

import { CancelWithdrawalUseCase } from '../../application/use-cases/cancel-withdrawal.use-case'
import { CreateCryptoDepositUseCase } from '../../application/use-cases/create-crypto-deposit.use-case'
import { CreateFiatDepositUseCase } from '../../application/use-cases/create-fiat-deposit.use-case'
import { CreateWithdrawalUseCase } from '../../application/use-cases/create-withdrawal.use-case'
import { GetDepositStatusUseCase } from '../../application/use-cases/get-deposit-status.use-case'
import { ListWithdrawalsUseCase } from '../../application/use-cases/list-withdrawals.use-case'
import { CreateCryptoDepositSchema } from '../dto/create-crypto-deposit.dto'
import { CreateFiatDepositSchema } from '../dto/create-fiat-deposit.dto'
import { CreateCryptoWithdrawalSchema, CreateFiatWithdrawalSchema } from '../dto/create-withdrawal.dto'

@UseGuards(AuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private fiatDep: CreateFiatDepositUseCase,
    private cryptoDep: CreateCryptoDepositUseCase,
    private createWd: CreateWithdrawalUseCase,
    private cancelWd: CancelWithdrawalUseCase,
    private depStatusUc: GetDepositStatusUseCase,
    private listWdUc: ListWithdrawalsUseCase,
  ) {}
  @Post('deposit/fiat')
  @UsePipes(new ZodValidationPipe(CreateFiatDepositSchema))
  depositFiat(
    @CurrentUser() u: UserActor,
    @Body() b: { amount: string; currency: string; method: string },
  ): Promise<{ payment_request_id: string; payment_url: string; currency: string; method: string; }> {
    return this.fiatDep.execute(u.id, { amount: b.amount, currency: b.currency, method: b.method })
  }
  @Post('deposit/crypto')
  @UsePipes(new ZodValidationPipe(CreateCryptoDepositSchema))
  depositCrypto(@CurrentUser() u: UserActor, @Body() b: { amount: string; currency: string }): Promise<{ payment_request_id: string; pay_address: string; pay_amount: string; pay_currency: string; expires_at: string; }> {
    return this.cryptoDep.execute(u.id, b.amount, b.currency)
  }
  @Get('deposit/:id/status')
  depositStatus(@CurrentUser() u: UserActor, @Param('id') id: string): Promise<{ id: string; status: PaymentStatus; currency: string; amount: string; payment_url: string | null; completed_at: Date | null; }> {
    return this.depStatusUc.execute(u.id, id)
  }
  @Post('withdrawal/fiat')
  @UsePipes(new ZodValidationPipe(CreateFiatWithdrawalSchema))
  wdFiat(
    @CurrentUser() u: UserActor,
    @Body() b: { amount: string; method: string; destination: string },
  ): Promise<{ payment_request_id: string; }> {
    return this.createWd.execute(u.id, {
      amount: b.amount,
      currency: 'RUB',
      method: b.method,
      destination: b.destination,
    })
  }
  @Post('withdrawal/crypto')
  @UsePipes(new ZodValidationPipe(CreateCryptoWithdrawalSchema))
  wdCrypto(
    @CurrentUser() u: UserActor,
    @Body() b: { amount: string; currency: string; destination: string },
  ): Promise<{ payment_request_id: string; }> {
    return this.createWd.execute(u.id, {
      amount: b.amount,
      currency: b.currency,
      destination: b.destination,
    })
  }
  @Get('withdrawals')
  listWd(
    @CurrentUser() u: UserActor,
    @Query() q: Record<string, string | undefined>,
  ): Promise<Awaited<ReturnType<ListWithdrawalsUseCase['execute']>>> {
    const page = parseInt(q.page ?? '') || 1
    return this.listWdUc.execute(u.id, page, parseInt(q.per_page ?? '') || 20)
  }
  @Post('withdrawal/:id/cancel')
  cancel(@CurrentUser() u: UserActor, @Param('id') id: string): Promise<{ ok: boolean; }> {
    return this.cancelWd.execute(u.id, id)
  }
}
