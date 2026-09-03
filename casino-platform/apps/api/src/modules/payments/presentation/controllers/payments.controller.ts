import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type UserActor } from '@/common/types/req-user'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'

import { type PaymentProvider, type PaymentStatus, type PaymentType, type Prisma } from '@casino/database'

import { CancelWithdrawalUseCase } from '../../application/use-cases/cancel-withdrawal.use-case'
import { CreateCryptoDepositUseCase } from '../../application/use-cases/create-crypto-deposit.use-case'
import { CreateFiatDepositUseCase } from '../../application/use-cases/create-fiat-deposit.use-case'
import { CreateWithdrawalUseCase } from '../../application/use-cases/create-withdrawal.use-case'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'
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
    private repo: PaymentRequestRepository,
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
  async depositStatus(@CurrentUser() u: UserActor, @Param('id') id: string): Promise<{ id: string; status: PaymentStatus; currency: string; amount: string; payment_url: string | null; completed_at: Date | null; }> {
    const pr = await this.repo.findById(id)
    if (!pr || pr.userId !== u.id) {
      throw new BadRequestException('NOT_FOUND')
    }
    return {
      id: pr.id,
      status: pr.status,
      currency: pr.currency,
      amount: pr.amount.toString(),
      payment_url: pr.paymentUrl,
      completed_at: pr.completedAt,
    }
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
  async listWd(
    @CurrentUser() u: UserActor,
    @Query() q: Record<string, string | undefined>,
  ): Promise<{ items: { id: string; createdAt: Date; updatedAt: Date; type: PaymentType; amount: Prisma.Decimal; idempotencyKey: string; metadata: Prisma.JsonValue; userId: string; currency: string; status: PaymentStatus; provider: PaymentProvider; method: string | null; amountRub: Prisma.Decimal | null; fee: Prisma.Decimal; externalId: string | null; externalStatus: string | null; paymentUrl: string | null; destination: Prisma.JsonValue; errorMessage: string | null; expiresAt: Date | null; completedAt: Date | null; }[]; meta: { page: number; total: number; }; }> {
    const page = parseInt(q.page ?? '') || 1
    const [items, total] = await this.repo.listUser({
      userId: u.id,
      type: 'withdrawal',
      page,
      perPage: parseInt(q.per_page ?? '') || 20,
    })
    return { items, meta: { page, total } }
  }
  @Post('withdrawal/:id/cancel')
  cancel(@CurrentUser() u: UserActor, @Param('id') id: string): Promise<{ ok: boolean; }> {
    return this.cancelWd.execute(u.id, id)
  }
}
