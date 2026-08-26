import { randomBytes } from 'crypto'

import { Injectable } from '@nestjs/common'
import Decimal from 'decimal.js'

import { prisma } from '@casino/database'

import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { InsufficientFundsError } from '../../../wallet/domain/errors'
import {
  CurrencyNotSupportedError,
  GameDisabledError,
  GameNotFoundError,
  ProviderDisabledError,
} from '../../domain/errors'
import { ProviderAdapterFactory } from '../../infrastructure/providers/provider-adapter.factory'

@Injectable()
export class LaunchGameUseCase {
  constructor(
    private adapters: ProviderAdapterFactory,
    private wallet: WalletFacade,
  ) {}

  async execute(input: {
    userId?: string | null
    gameSlug: string
    currency: string
    returnUrl: string
    isDemo: boolean
    isMobile: boolean
    ip: string
  }) {
    const game = await prisma.game.findUnique({ where: { slug: input.gameSlug }, include: { provider: true } })
    if (!game) throw new GameNotFoundError(input.gameSlug)
    if (!input.isDemo && !game.isEnabled) throw new GameDisabledError()
    if (!game.provider.isEnabled) throw new ProviderDisabledError()

    if (!input.isDemo && input.userId) {
      const supported = (game.supportedCurrencies as string[] | null) ?? []
      const providerSupported = (game.provider.config as any)?.supported_currencies as string[] | undefined
      const allowed = supported.length ? supported : providerSupported ?? [input.currency]
      if (allowed.length && !allowed.includes(input.currency)) {
        throw new CurrencyNotSupportedError(input.currency)
      }

      const bal = await this.wallet.getBalance(input.userId, input.currency as any)
      if (new Decimal(bal.available).lte(0)) {
        throw new InsufficientFundsError('0.01', bal.available)
      }
    }

    let session: any = null
    if (!input.isDemo && input.userId) {
      await prisma.gameSession.updateMany({
        where: { userId: input.userId, providerId: game.providerId, status: 'active' },
        data: { status: 'closed', closedAt: new Date() },
      })
      const sessionToken = randomBytes(32).toString('hex')
      session = await prisma.gameSession.create({
        data: {
          userId: input.userId,
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
}
