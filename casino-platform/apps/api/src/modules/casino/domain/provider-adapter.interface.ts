import type { ParsedProviderCallback } from '@casino/shared-types'

/** Read-форма разобранного callback'а живёт в @casino/shared-types (В4); тут
 *  реэкспорт: контракт адаптера и потребители application/presentation продолжают
 *  ссылаться на то же имя. */
export type { ParsedProviderCallback }

export interface LaunchParams {
  gameExternalId: string
  sessionToken: string
  playerToken: string
  currency: string
  language: string
  returnUrl: string
  isDemo: boolean
  isMobile: boolean
  ip: string
}
/** Строка игрового каталога провайдера (нормализованная). */
export interface ProviderGameRow {
  externalGameId: string
  name: string
  type?: string | undefined
  category?: string | undefined
  thumbnailUrl?: string | undefined
  hasDemo: boolean
  rtp?: number | undefined
  metadata?: Record<string, unknown>
}
/** Тело ответа провайдеру на callback (формат зависит от адаптера). */
export type ProviderCallbackResponse = Record<string, unknown>
export interface GameProviderAdapter {
  getLaunchUrl(params: LaunchParams): Promise<{ url: string }>
  fetchGameList(): Promise<ProviderGameRow[]>
  verifyCallback(headers: Record<string, unknown>, body: unknown): boolean
  parseCallback(headers: Record<string, unknown>, body: unknown): ParsedProviderCallback
  formatSuccessResponse(balance: string, transactionId?: string): ProviderCallbackResponse
  formatErrorResponse(code: string, message: string): ProviderCallbackResponse
}
