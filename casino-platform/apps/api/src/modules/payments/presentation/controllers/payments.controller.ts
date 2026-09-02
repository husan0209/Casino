import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  UsePipes,
} from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type UserActor } from '@/common/types/req-user'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'

import { CancelWithdrawalUseCase } from '../../application/use-cases/cancel-withdrawal.use-case'
import { CreateCryptoDepositUseCase } from '../../application/use-cases/create-crypto-deposit.use-case'
import { CreateFiatDepositUseCase } from '../../application/use-cases/create-fiat-deposit.use-case'
import { CreateWithdrawalUseCase } from '../../application/use-cases/create-withdrawal.use-case'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'
import { CreateCryptoDepositSchema } from '../dto/create-crypto-deposit.dto'
import { CreateFiatDepositSchema } from '../dto/create-fiat-deposit.dto'
import {
  CreateFiatWithdrawalSchema,
  CreateCryptoWithdrawalSchema,
} from '../dto/create-withdrawal.dto'

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
  @UsePipes(new ZodValidationPipe(CreateFiatDepositSchema))
  depositFiat(
    @CurrentUser() u: UserActor,
    @Body() b: { amount: string; currency: string; method: string },
  ) {
    return this.fiatDep.execute(u.id, { amount: b.amount, currency: b.currency, method: b.method })
  }
  @Post('deposit/crypto')
  @UsePipes(new ZodValidationPipe(CreateCryptoDepositSchema))
  depositCrypto(@CurrentUser() u: UserActor, @Body() b: { amount: string; currency: string }) {
    return this.cryptoDep.execute(u.id, b.amount, b.currency)
  }
  @Get('deposit/:id/status')
  async depositStatus(@CurrentUser() u: UserActor, @Param('id') id: string) {
    const pr = await this.repo.findById(id)
    if (!pr || pr.userId !== u.id) {
      throw new BadRequestException('NOT_FOUND')
    }
    return {
      id: pr.id,
      status: pr.status,
      currency: pr.currency,
      amount: pr.amount.toString() ?? pr.amount,
      payment_url: pr.paymentUrl,
      completed_at: pr.completedAt,
    }
  }
  @Post('withdrawal/fiat')
  @UsePipes(new ZodValidationPipe(CreateFiatWithdrawalSchema))
  wdFiat(
    @CurrentUser() u: UserActor,
    @Body() b: { amount: string; method: string; destination: string },
  ) {
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
  ) {
    return this.createWd.execute(u.id, {
      amount: b.amount,
      currency: b.currency,
      destination: b.destination,
    })
  }
  @Get('withdrawals')
  async listWd(
    @CurrentUser() u: UserActor,
    @Query() q: Record<string, string | undefined>,
  ) {
    const page = parseInt(q.page ?? '') || 1
    const [items, total] = await this.repo.listUser({
      userId: u.id,
      type: 'withdrawal',
      page,
      perPage: parseInt(q.per_page) || 20,
    })
    return { items, meta: { page, total } }
  }
  @Post('withdrawal/:id/cancel')
  cancel(@CurrentUser() u: UserActor, @Param('id') id: string) {
    return this.cancelWd.execute(u.id, id)
  }
}
