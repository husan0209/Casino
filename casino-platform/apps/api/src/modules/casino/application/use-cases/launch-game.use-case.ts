import { randomBytes } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import Decimal from 'decimal.js'

import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { InsufficientFundsError } from '../../../wallet/domain/errors'
import {
  CurrencyNotSupportedError,
  GameDisabledError,
  GameNotFoundError,
  ProviderDisabledError,
} from '../../domain/errors'
import {
  GAME_CATALOG_REPOSITORY,
  GAME_PLAY_REPOSITORY,
  type GameWithProvider,
  type IGameCatalogRepository,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'
import { ProviderAdapterFactory } from '../../infrastructure/providers/provider-adapter.factory'

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
    @Inject(GAME_CATALOG_REPOSITORY) private readonly catalog: IGameCatalogRepository,
    @Inject(GAME_PLAY_REPOSITORY) private readonly play: IGamePlayRepository,
  ) {}

  async execute(input: LaunchGameInput) {
    const game = await this.catalog.findBySlug(input.gameSlug)
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
    await this.play.closeActiveSessions(userId, game.providerId)
    const session = await this.play.createSession({
      userId,
      gameId: game.id,
      providerId: game.providerId,
      sessionToken: randomBytes(32).toString('hex'),
      currency: input.currency,
      isDemo: false,
      status: 'active',
      ipAddress: input.ip,
    })
    await this.catalog.incrementLaunchCount(game.id)
    return session
  }
}
