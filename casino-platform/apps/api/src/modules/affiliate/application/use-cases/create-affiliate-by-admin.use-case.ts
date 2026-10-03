/**
 * UC-AFF-17: ручное создание партнёра администратором (ТЗ ч.8 §10.3) — для
 * оффлайн-партнёров, пришедших по договору без самостоятельной регистрации.
 *
 * ВОЛНА В3. До переноса контроллер `affiliate-admin.controller.ts` сам вызывал
 * `affiliates.generateUniqueTrackingCode()` и `affiliates.create()`, то есть
 * presentation-слой писал в БД.
 *
 * ДВА ДЕФЕКТА ПОВЕДЕНИЯ ИСПРАВЛЕНЫ ЗДЕСЬ ЖЕ (подробности — в отчёте PR):
 *  1. `userId` брался из `admin.id` — это id из таблицы `admin_users`, а
 *     `affiliates.user_id` — FK на `users.id` под `@unique`. Запрос падал на
 *     нарушении внешнего ключа (HTTP 500). Теперь, как и при самостоятельной
 *     регистрации, партнёру создаётся СВОЯ user-запись: начисления идут на его
 *     кошелёк, а не на кошелёк администратора (решение D3).
 *  2. `passwordHash` писался пустой строкой, хотя схема запроса требует
 *     `password`: такой партнёр не мог войти в кабинет никогда. Хеш считается
 *     здесь тем же argon2id, что и при регистрации.
 *
 * Компенсирующее удаление user-записи при отказе записи партнёра — как в
 * `RegisterAffiliateUseCase`: иначе в `users` оставалась бы сирота.
 */
import { Inject, Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import {
  AFFILIATE_PLAYER_PROVISIONING_REPOSITORY,
  AFFILIATE_REPOSITORY,
  type AffiliatePlayerProvisioningRepository,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'
import { parseRevShareRate } from '../../domain/value-objects/revshare-rate.value-object'
import { generateUniquePlayerReferralCode } from '../affiliate-player-referral-code'
import { AffiliateSettingsService } from '../affiliate-settings.service'

import type { AffiliateEntity } from '../../domain/entities/affiliate.entity'

export interface CreateAffiliateByAdminInput {
  email: string
  /** Пароль из запроса администратора: без него партнёр не сможет войти. */
  password: string
  /** Индивидуальная ставка; не задана — ставка программы по умолчанию. */
  revshareRate?: string | undefined
  payoutCurrency: string
  displayName?: string | null | undefined
  country?: string | null | undefined
}

@Injectable()
export class CreateAffiliateByAdminUseCase {
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_PLAYER_PROVISIONING_REPOSITORY)
    private readonly players: AffiliatePlayerProvisioningRepository,
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
  ) {}

  async execute(input: CreateAffiliateByAdminInput): Promise<AffiliateEntity> {
    const email = input.email.toLowerCase().trim()
    const revshareRate =
      input.revshareRate !== undefined
        ? parseRevShareRate(input.revshareRate)
        : parseRevShareRate((await this.settings.get()).defaultRevshareRate)

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id })
    const trackingCode = await this.affiliates.generateUniqueTrackingCode()
    const player = await this.players.createPlayerUser({
      referralCode: await generateUniquePlayerReferralCode(this.players),
    })

    try {
      return await this.affiliates.create({
        userId: player.id,
        email,
        passwordHash,
        trackingCode,
        revshareRate,
        payoutCurrency: input.payoutCurrency,
        displayName: input.displayName ?? null,
        country: input.country ?? null,
        // Оффлайн-партнёр приходит по договору: согласие сторон уже получено,
        // иначе админ не смог бы завести его руками (ТЗ ч.8 §10.3).
        isAgreed: true,
      })
    } catch (error) {
      await this.players.deletePlayerUser(player.id).catch(() => undefined)
      throw error
    }
  }
}
