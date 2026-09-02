/**
 * Безопасное извлечение сообщения из unknown (вместо `catch (e: any)`, GAP-39).
 *
 * Покрывает: Error (включая AppError с .code), thrown-строки, объекты с
 * .message, прочее (String()). Возвращает всегда непустую строку, если
 * только ошибка не строка/сообщение пустые — тогда String(e).
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message
  }
  if (typeof e === 'string') {
    return e
  }
  const msg = (e as { message?: unknown } | null)?.message
  if (typeof msg === 'string' && msg.length > 0) {
    return msg
  }
  return String(e)
}
