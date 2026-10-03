/**
 * Генерация служебного referral_code для user-записи партнёра.
 *
 * ВЫНЕСЕНО ИЗ `RegisterAffiliateUseCase` без изменения алгоритма: тот же код
 * нужен ручному созданию партнёра админом (UC-AFF-17), а расходящиеся алфавиты
 * в двух местах дали бы два разных формата кодов в одной колонке.
 *
 * Поле `users.referral_code` обязательное (NOT NULL), хотя партнёр его не
 * использует: клиентская рефералка показывает только игровые коды. Поэтому
 * префикс `aff` — сигнал данным, что это служебная запись партнёра.
 * `randomBytes`, а не `Math.random()`: коллизия кодов партнёров выглядела бы
 * как ошибка генерации.
 */
import { randomBytes } from 'node:crypto'

import { PlayerReferralCodeGenerationError } from '../domain/errors/affiliate.errors'
import { type AffiliatePlayerProvisioningRepository } from '../domain/repositories/affiliate.repository'

/** Сколько попыток сгенерировать уникальный служебный referral_code. */
const REFERRAL_CODE_ATTEMPTS = 5
/** Префикс служебного кода партнёра. */
const REFERRAL_CODE_PREFIX = 'aff'
/** Алфавит без 0/O/1/I — как у игровых реферальных кодов. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

export async function generateUniquePlayerReferralCode(
  players: AffiliatePlayerProvisioningRepository,
): Promise<string> {
  for (let attempt = 0; attempt < REFERRAL_CODE_ATTEMPTS; attempt++) {
    const bytes = randomBytes(CODE_LENGTH)
    let suffix = ''
    for (let index = 0; index < CODE_LENGTH; index++) {
      suffix += CODE_ALPHABET[bytes[index]! % CODE_ALPHABET.length]
    }
    const candidate = `${REFERRAL_CODE_PREFIX}${suffix}`
    if (await players.isPlayerReferralCodeAvailable(candidate)) {
      return candidate
    }
  }
  throw new PlayerReferralCodeGenerationError(REFERRAL_CODE_ATTEMPTS)
}

export { CODE_ALPHABET, REFERRAL_CODE_PREFIX }
