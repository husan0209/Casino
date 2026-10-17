/**
 * Тексты и клиентское правило партнёрского пароля (восстановление доступа).
 *
 * Общий источник для двух экранов — сброс по ссылке из письма и смена пароля в
 * кабинете: русская фраза привязана к стабильному коду ошибки из контракта
 * `/affiliate/auth/*`, а не к сообщению с API (сообщение техническое, код
 * гарантирует docs/AI_DEVELOPMENT_RULES §6). Две копии разъехались бы при первой
 * же правке правила — ровно так, как разъехалась однажды шкала силы пароля,
 * пока её не вынесли в `components/auth/PasswordStrength`.
 */

/**
 * Правило партнёрского пароля — только длина. Зеркало кода `WEAK_PASSWORD`,
 * БЕЗ требования цифры: цифра есть в правиле игрового сброса
 * (`ResetPasswordSchema`), а партнёрская схема — 8 символов, и локальная
 * проверка не имеет права отвергать пароль, который сервер принимает.
 */
export const AFFILIATE_PASSWORD_MIN_LENGTH = 8

/** Подсказка под новым паролем: та же формулировка, что на игровом сбросе. */
export const AFFILIATE_PASSWORD_TOO_SHORT_TEXT = 'Минимум 8 символов'
export const AFFILIATE_PASSWORD_MISMATCH_TEXT = 'Пароли не совпадают'

const ERROR_LABEL: Record<string, string> = {
  AFFILIATE_TOKEN_INVALID: 'Ссылка недействительна. Запросите новую.',
  AFFILIATE_TOKEN_EXPIRED: 'Ссылка протухла — она живёт час. Запросите новую.',
  AFFILIATE_TOKEN_ALREADY_USED: 'Эта ссылка уже использована. Запросите новую.',
  WEAK_PASSWORD: 'Пароль слишком простой: минимум 8 символов.',
  AFFILIATE_PASSWORD_INVALID_CURRENT: 'Текущий пароль указан неверно.',
}

/** Русская подпись кода ошибки; undefined — если кода нет в справочнике. */
export function affiliatePasswordErrorLabel(code: string | undefined): string | undefined {
  if (code === undefined) {
    return undefined
  }
  return ERROR_LABEL[code]
}

/**
 * Проверка до отправки: текст проблемы или null. Ссылка сброса одноразовая,
 * поэтому цена пропущенной опечатки — сожжённый токен и новый запрос, а не
 * просто ошибка под полем.
 */
export function affiliatePasswordProblem(password: string, repeat: string): string | null {
  if (password.length < AFFILIATE_PASSWORD_MIN_LENGTH) {
    return AFFILIATE_PASSWORD_TOO_SHORT_TEXT
  }
  if (repeat !== password) {
    return AFFILIATE_PASSWORD_MISMATCH_TEXT
  }
  return null
}
