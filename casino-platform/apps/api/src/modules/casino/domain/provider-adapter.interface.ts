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
  rawRequest: any
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
  metadata?: any
}
export interface GameProviderAdapter {
  getLaunchUrl(params: LaunchParams): Promise<{ url: string }>
  fetchGameList(): Promise<ProviderGameRow[]>
  verifyCallback(headers: any, body: any): boolean
  parseCallback(headers: any, body: any): ParsedProviderCallback
  formatSuccessResponse(balance: string, transactionId?: string): any
  formatErrorResponse(code: string, message: string): any
}
