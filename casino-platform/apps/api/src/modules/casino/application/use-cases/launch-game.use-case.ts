import { randomBytes } from 'crypto'

import { Injectable } from '@nestjs/common'
import Decimal from 'decimal.js'

import { prisma, type Prisma } from '@casino/database'

import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { InsufficientFundsError } from '../../../wallet/domain/errors'
import {
  CurrencyNotSupportedError,
  GameDisabledError,
  GameNotFoundError,
  ProviderDisabledError,
} from '../../domain/errors'
import { ProviderAdapterFactory } from '../../infrastructure/providers/provider-adapter.factory'

type GameWithProvider = Prisma.GameGetPayload<{ include: { provider: true } }>

interface LaunchGameInput {
  userId?: string | null
  gameSlug: string
  currency: string
  returnUrl: string
  isDemo: boolean
  isMobile: boolean
  ip: string
}

/** Узкий тип того, что use-case использует от созданной сессии (id + token). */
interface ActiveGameSession {
  id: string
  sessionToken: string
}

@Injectable()
export class LaunchGameUseCase {
  constructor(
    private adapters: ProviderAdapterFactory,
    private wallet: WalletFacade,
  ) {}

  async execute(input: LaunchGameInput) {
    const game = await prisma.game.findUnique({
      where: { slug: input.gameSlug },
      include: { provider: true },
    })
    if (!game) {
      throw new GameNotFoundError(input.gameSlug)
    }
    if (!input.isDemo && !game.isEnabled) {
      throw new GameDisabledError()
    }
    if (!game.provider.isEnabled) {
      throw new ProviderDisabledError()
    }

    let session: ActiveGameSession | null = null
    if (!input.isDemo && input.userId) {
      this.assertCurrencySupported(game, input)
      await this.ensureSufficientFunds(input.userId, input.currency)
      session = await this.persistActiveSession(game, input)
    }

    const adapter = this.adapters.getAdapter(game.provider.slug)
    const launch = await adapter.getLaunchUrl({
      gameExternalId: game.externalGameId,
      sessionToken: session?.sessionToken || 'demo_' + randomBytes(16).toString('hex'),
      playerToken: session?.sessionToken || '',
      currency: input.currency,
      language: 'ru',
      returnUrl: input.returnUrl,
      isDemo: input.isDemo,
      isMobile: input.isMobile,
      ip: input.ip,
    })
    return { session_id: session?.id ?? null, launch_url: launch.url, currency: input.currency }
  }

  /** Реальная или провайдерская валютная сетка; демо и гости не проверяются. */
  private assertCurrencySupported(game: GameWithProvider, input: LaunchGameInput): void {
    const supported = (game.supportedCurrencies as string[] | null) ?? []
    const providerSupported = (game.provider.config as any)?.supported_currencies as
      string[] | undefined
    const allowed = supported.length ? supported : (providerSupported ?? [input.currency])
    if (allowed.length && !allowed.includes(input.currency)) {
      throw new CurrencyNotSupportedError(input.currency)
    }
  }

  private async ensureSufficientFunds(userId: string, currency: string): Promise<void> {
    const bal = await this.wallet.getBalance(userId, currency as any)
    if (new Decimal(bal.available).lte(0)) {
      throw new InsufficientFundsError('0.01', bal.available)
    }
  }

  /** Одна активная сессия на (user, provider): старые закрываются, launchCount инкрементится. */
  private async persistActiveSession(
    game: GameWithProvider,
    input: LaunchGameInput,
  ): Promise<ActiveGameSession> {
    const userId = input.userId as string
    await prisma.gameSession.updateMany({
      where: { userId, providerId: game.providerId, status: 'active' },
      data: { status: 'closed', closedAt: new Date() },
    })
    const sessionToken = randomBytes(32).toString('hex')
    const session = await prisma.gameSession.create({
      data: {
        userId,
        gameId: game.id,
        providerId: game.providerId,
        sessionToken,
        currency: input.currency,
        isDemo: false,
        status: 'active',
        ipAddress: input.ip,
      },
    })
    await prisma.game.update({ where: { id: game.id }, data: { launchCount: { increment: 1 } } })
    return session
  }
}
