/**
 * Порт статуса учётной записи игрока (G24).
 *
 * WHY. Блокировка игрока исторически делал `admin`: `prisma.user.update` +
 * `prisma.session.updateMany` прямо из своего репозитория. Обе таблицы админу
 * не принадлежат (карта `MODEL_OWNERS`: `User` — users+auth, `Session` —
 * auth+users), то есть это запись в чужую таблицу, и она же лишала users
 * монополии на правило «заблокировал — значит sessions живые не остаются».
 *
 * Операция здесь одна на каждое действие, а не `setStatus(status)`: отзыв
 * сессий — часть блокировки, а не параметр, который вызывающий может забыть.
 */
export interface IUserStatusRepository {
  /**
   * `status='blocked'` + отзыв всех активных сессий.
   *
   * Реализация обязана сделать это ОДНОЙ транзакцией: если между шагами упасть,
   * игрок остаётся заблокированным, но с живой сессией, и дальше работает
   * (guard читает сессию, а не статус).
   */
  block(userId: string): Promise<void>

  /** `status='active'`; сессии не восстанавливаются — отозванное не возвращается. */
  unblock(userId: string): Promise<void>
}

export const USER_STATUS_REPOSITORY = Symbol('USER_STATUS_REPOSITORY')
