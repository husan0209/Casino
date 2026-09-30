/**
 * Порты для побочных эффектов самоисключения (ТЗ ч.8 §14.1, решение C).
 *
 * ЗАЧЕМ ПОРТ, А НЕ ПРЯМОЙ ИМПОРТ. `users` не должен знать про модуль
 * `affiliate`. Реализацию (clawback начислений) поставляет affiliate-модуль
 * через DI, а users видит только интерфейс. Так зависимость остаётся
 * односторонней (users → порт, affiliate → порт), циклов не возникает.
 *
 * Хук вызывается ПОСЛЕ успешной записи самоисключения и отзыва сессий.
 */
export interface ResponsibleGamingHook {
  /**
   * Вызывается, когда игрок включил самоисключение.
   *
   * Реализация обязана быть best-effort: ошибка хука не должна приводить к
   * откату самоисключения — самоисключение важнее любой партнёрской аналитики.
   */
  onSelfExclusion(playerId: string): Promise<void>
}

export const RESPONSIBLE_GAMING_HOOK = Symbol('RESPONSIBLE_GAMING_HOOK')

/**
 * Заглушка на случай, если модуль-поставщик не подключён (например, в
 * изолированном тесте users-модуля). Молча ничего не делает — корректная
 * деградация вместо падения.
 */
export class NoopResponsibleGamingHook implements ResponsibleGamingHook {
  onSelfExclusion(): Promise<void> {
    return Promise.resolve()
  }
}
