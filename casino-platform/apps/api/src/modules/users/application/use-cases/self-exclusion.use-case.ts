import { Inject, Injectable, Logger, Optional } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import {
  NoopResponsibleGamingHook,
  RESPONSIBLE_GAMING_HOOK,
  type ResponsibleGamingHook,
} from '../../../../common/ports/responsible-gaming-hook'
import { InvalidSelfExclusionPeriodError } from '../../domain/errors'
import {
  USER_SETTINGS_REPOSITORY,
  type IUserSettingsRepository,
} from '../../domain/repositories/user-settings.repository'

// Minimum cooloff before self-exclusion can be lifted (72 hours)
const MIN_COOLOFF_MS = 72 * 60 * 60 * 1000

export class SelfExclusionActiveError extends Error {
  constructor(until: Date) {
    super(`SELF_EXCLUDED_UNTIL:${until.toISOString()}`)
    this.name = 'SelfExclusionActiveError'
  }
}

export class SelfExclusionCooloffError extends Error {
  constructor(canLiftAt: Date) {
    super(`SELF_EXCLUSION_COOLOFF_UNTIL:${canLiftAt.toISOString()}`)
    this.name = 'SelfExclusionCooloffError'
  }
}

@Injectable()
export class SelfExclusionUseCase {
  private readonly logger = new Logger(SelfExclusionUseCase.name)

  constructor(
    @Inject(USER_SETTINGS_REPOSITORY) private readonly settings: IUserSettingsRepository,
    // Опционален: дефолт-заглушка, чтобы users-модуль не зависел от
    // подключения affiliate-модуля (в т.ч. в изолированных тестах).
    @Optional()
    @Inject(RESPONSIBLE_GAMING_HOOK)
    private readonly responsibleGamingHook: ResponsibleGamingHook = new NoopResponsibleGamingHook(),
  ) {}

  /**
   * Activate self-exclusion for a user.
   * periodHours: number of hours OR 0 = permanent
   */
  async exclude(userId: string, periodHours: number): Promise<{ excludedUntil: Date | null }> {
    if (periodHours < 0) {
      throw new InvalidSelfExclusionPeriodError()
    }
    // Minimum 24 hours — we enforce this server-side regardless of client input
    if (periodHours > 0 && periodHours < 24) {
      periodHours = 24
    }

    const excludedUntil =
      periodHours === 0
        ? new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000) // 100 years ~ permanent
        : new Date(Date.now() + periodHours * 60 * 60 * 1000)

    // Upsert UserSettings
    await this.settings.upsertExclusion(userId, excludedUntil)

    // Revoke all active sessions immediately
    await this.settings.revokeActiveSessions(userId)

    await this.notifyResponsibleGamingHook(userId)

    return { excludedUntil }
  }

  /**
   * Уведомляет подписчиков (affiliate: clawback начислений).
   *
   * Ошибка хука НЕ пробрасывается: самоисключение уже записано, отзыв сессий
   * выполнен. Откатывать из-за сбоя партнёрского контура нельзя — игрок,
   * решивший бросить, должен остаться заблокированным в любом случае.
   */
  private async notifyResponsibleGamingHook(userId: string): Promise<void> {
    try {
      await this.responsibleGamingHook.onSelfExclusion(userId)
    } catch (err) {
      this.logger.error(`Responsible gaming hook failed for user=${userId}: ${errorMessage(err)}`)
    }
  }

  /**
   * Lift self-exclusion — only allowed after MIN_COOLOFF_MS from the
   * time the exclusion was SET (we store the setAt moment implicitly
   * via the updatedAt column).
   */
  async lift(userId: string): Promise<{ ok: boolean }> {
    const settings = await this.settings.find(userId)

    if (!settings?.selfExcludedUntil) {
      // Not excluded — nothing to do
      return { ok: true }
    }

    // Use updatedAt as proxy for when exclusion was set
    const setAt = settings.updatedAt
    const canLiftAt = new Date(setAt.getTime() + MIN_COOLOFF_MS)
    if (new Date() < canLiftAt) {
      throw new SelfExclusionCooloffError(canLiftAt)
    }

    await this.settings.clearExclusion(userId)

    return { ok: true }
  }

  /**
   * Assert user is NOT self-excluded. Throws if they are.
   * Call this from LoginUseCase.
   */
  async assertNotExcluded(userId: string): Promise<void> {
    const settings = await this.settings.find(userId)
    if (settings?.selfExcludedUntil && settings.selfExcludedUntil > new Date()) {
      throw new SelfExclusionActiveError(settings.selfExcludedUntil)
    }
  }
}
