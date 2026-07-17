export interface LaunchParams {
  gameExternalId: string; sessionToken: string; playerToken: string;
  currency: string; language: string; returnUrl: string;
  isDemo: boolean; isMobile: boolean; ip: string;
}
export interface ParsedProviderCallback {
  action: 'authenticate' | 'balance' | 'bet' | 'win' | 'rollback'
  playerToken?: string
  playerId?: string
  betAmount?: string
  winAmount?: string
  roundId?: string
  transactionId?: string
  rollbackTransactionId?: string
  gameId?: string
  rawRequest: any
  currency?: string
}
export interface GameProviderAdapter {
  getLaunchUrl(params: LaunchParams): Promise<{ url: string }>
  fetchGameList(): Promise<Array<{
    externalGameId: string; name: string; type?: string; category?: string;
    thumbnailUrl?: string; hasDemo: boolean; rtp?: number; metadata?: any
  }>>
  verifyCallback(headers: any, body: any): boolean
  parseCallback(headers: any, body: any): ParsedProviderCallback
  formatSuccessResponse(balance: string, transactionId?: string): any
  formatErrorResponse(code: string, message: string): any
}
