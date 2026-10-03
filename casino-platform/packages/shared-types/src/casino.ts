/**
 * Разобранный callback игрового провайдера (нормализованный результат
 * `GameProviderAdapter.parseCallback`).
 *
 * В4: это read-форма входящего события, а не доменная сущность — она нигде не
 * мутируется и попадает в presentation как параметр маршрутизации callback'а,
 * поэтому живёт в shared-types. Ставки (`betAmount`/`winAmount`) — деньги,
 * значит строки (AI_DEVELOPMENT_RULES §1).
 */
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
