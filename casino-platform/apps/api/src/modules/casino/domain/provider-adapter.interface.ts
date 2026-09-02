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
export interface ParsedProviderCallback {
  action: 'authenticate' | 'balance' | 'bet' | 'win' | 'rollback'
  playerToken?: string | undefined
  playerId?: string | undefined
  betAmount?: string | undefined
  winAmount?: string | undefined
  roundId?: string | undefined
  transactionId?: string | undefined
  rollbackTransactionId?: string | undefined
  gameId?: string | undefined
  rawRequest: unknown
  currency?: string | undefined
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
