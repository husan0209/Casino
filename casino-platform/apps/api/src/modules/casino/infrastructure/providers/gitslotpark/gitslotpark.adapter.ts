import { createHmac, timingSafeEqual } from 'crypto'

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { PaymentProviderNotConfiguredError } from '../../../../payments/infrastructure/clients/rukassa.client'
import {
  type GameProviderAdapter,
  type LaunchParams,
  type ParsedProviderCallback,
} from '../../../domain/provider-adapter.interface'

const has = (v: unknown): boolean => v !== null && v !== undefined

/**
 * GitSlotPark Seamless Wallet API v2 — агрегатор Pragmatic Play / PG Soft /
 * Amatic / Amusnet (EGT).
 *
 * Схема (inverted wallet): GitSlotPark вызывает НАШ callback-сервис:
 *   POST {OUR_BASE}/GetBalance | Withdraw | Deposit | BetWin | RollbackTransaction
 * Sign: HMAC-SHA256(secret, concat полей в фиксированном порядке), UPPERCASE hex,
 * суммы строго 2 знака после запятой. Коды результатов: 0 ok, 6 no funds,
 * 8 нет ref-tx, 9 уже откат, 11 дубликат.
 *
 * Запуск игры: POST {API}/userAuth {agentID,userID,lang,gameid,isaffiliate,lobbyUrl}
 * Каталог: GET {API}/gamelist
 */
const AMT = (v: any) => Number(v ?? 0).toFixed(2)

@Injectable()
export class GitslotparkProviderAdapter implements GameProviderAdapter {
  private readonly logger = new Logger(GitslotparkProviderAdapter.name)

  constructor(private config: ConfigService) {}

  private creds() {
    const agentId = this.config.get<string>('GITSLOTPARK_AGENT_ID')
    const apiToken = this.config.get<string>('GITSLOTPARK_API_TOKEN')
    const secret = this.config.get<string>('GITSLOTPARK_SECRET_KEY')
    if (!agentId || !apiToken || !secret) {
      throw new PaymentProviderNotConfiguredError(
        'GitSlotPark',
        'GITSLOTPARK_AGENT_ID, GITSLOTPARK_API_TOKEN, GITSLOTPARK_SECRET_KEY',
      )
    }
    return { agentId, apiToken, secret }
  }

  private sign(parts: Array<string | number>): string {
    const { secret } = this.creds()
    return createHmac('sha256', secret).update(parts.join('')).digest('hex').toUpperCase()
  }

  /** userAuth → URL игровой сессии. userID передаём наш внутренний userId. */
  async getLaunchUrl(params: LaunchParams) {
    const { agentId, apiToken } = this.creds()
    const base = this.config.get<string>('GITSLOTPARK_API_BASE') || 'https://apiv2.gitslotpark.com'
    const res = await fetch(`${base}/userAuth?api_token=${encodeURIComponent(apiToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentID: agentId,
        userID: params.playerToken, // наш userId — придёт обратно в колбэках
        lang: params.language || 'ru',
        gameid: Number(params.gameExternalId),
        isaffiliate: false,
        lobbyUrl: params.returnUrl,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      throw new Error(`userAuth HTTP ${res.status}`)
    }
    const d = (await res.json()) as Record<string, any>
    // ответ: {status:0, game_url|url|launch_url} — парсим defensively
    const url = String(d.game_url ?? d.url ?? d.launch_url ?? '')
    if (String(d.status ?? '0') !== '0' || !url) {
      throw new Error(`userAuth failed: ${JSON.stringify(d).slice(0, 200)}`)
    }
    return { url }
  }

  /** Каталог агрегатора: GET /gamelist?api_token=… */
  async fetchGameList() {
    const { apiToken } = this.creds()
    const base = this.config.get<string>('GITSLOTPARK_API_BASE') || 'https://apiv2.gitslotpark.com'
    const res = await fetch(`${base}/gamelist?api_token=${encodeURIComponent(apiToken)}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      throw new Error(`gamelist HTTP ${res.status}`)
    }
    const d = (await res.json()) as any
    const list: any[] = Array.isArray(d) ? d : (d.games ?? d.data ?? [])
    return list.map((g) => ({
      externalGameId: String(g.gameid ?? g.id ?? g.game_id),
      name: String(g.name ?? g.gameName ?? ''),
      type: g.type === 'live' ? 'live_roulette' : 'slot',
      category: g.type === 'live' ? 'live_casino' : 'slots',
      thumbnailUrl: g.image ?? g.thumbnail ?? undefined,
      hasDemo: Boolean(g.demo ?? g.freespin ?? false),
      rtp: g.rtp ? Number(g.rtp) : undefined,
      metadata: g,
    }))
  }

  /**
   * Проверка подписи. op приходит в заголовке x-gsp-op (ставит контроллер из пути).
   * ⚠️ Порядки конкатенации Withdraw/Deposit/BetWin сверить с менеджером GitSlotPark
   * при выдаче боевых ключей (в доках приведён общий принцип + один пример).
   */
  verifyCallback(headers: Record<string, string>, body: any): boolean {
    try {
      this.creds()
      const op = headers['x-gsp-op'] || ''
      let msg: string
      switch (op.toLowerCase()) {
        case 'getbalance':
          msg = `${body.agentID}${body.userID}`
          break
        case 'withdraw':
          msg = `${body.agentID}${body.userID}${AMT(body.amount)}${body.transactionID}${body.roundID}`
          break
        case 'deposit':
          msg = `${body.agentID}${body.userID}${AMT(body.amount)}${body.refTransactionID ?? ''}${body.transactionID ?? ''}${body.roundID ?? ''}`
          break
        case 'betwin':
          msg = `${body.agentID}${body.userID}${AMT(body.betAmount)}${AMT(body.winAmount)}${body.transactionID}${body.roundID}`
          break
        case 'rollbacktransaction':
          msg = `${body.agentID}${body.userID}${body.refTransactionID}`
          break
        default:
          return false
      }
      const expected = this.sign([msg])
      const given = String(body.sign ?? '').toUpperCase()
      const a = Buffer.from(given, 'hex')
      const b = Buffer.from(expected, 'hex')
      return a.length === b.length && timingSafeEqual(a, b)
    } catch (e: any) {
      this.logger.warn(`verifyCallback failed: ${e?.message}`)
      return false
    }
  }

  parseCallback(_headers: Record<string, string>, body: any): ParsedProviderCallback {
    const op = String(_headers['x-gsp-op'] || '').toLowerCase()
    const map: Record<string, ParsedProviderCallback['action']> = {
      getbalance: 'balance',
      withdraw: 'bet',
      betwin: 'win',
      deposit: 'win',
      rollbacktransaction: 'rollback',
    }
    return {
      action: map[op] ?? 'balance',
      // Seamless-модель: игрок идентифицируется по userID, не по session-token
      playerToken: has(body.userID) ? `uid:${body.userID}` : undefined,
      playerId: has(body.userID) ? String(body.userID) : undefined,
      betAmount: has(body.amount)
        ? String(body.amount)
        : has(body.betAmount)
          ? String(body.betAmount)
          : undefined,
      winAmount: has(body.winAmount)
        ? String(body.winAmount)
        : has(body.amount)
          ? String(body.amount)
          : undefined,
      roundId: has(body.roundID) ? String(body.roundID) : undefined,
      transactionId: has(body.transactionID) ? String(body.transactionID) : undefined,
      rollbackTransactionId: has(body.refTransactionID) ? String(body.refTransactionID) : undefined,
      gameId: has(body.gameID) ? String(body.gameID) : undefined,
      rawRequest: body,
    }
  }

  formatSuccessResponse(balance: string, _transactionId?: string) {
    // Код результата 0 = success по таблице GitSlotPark
    return { status: 0, balance: Number(balance).toFixed(2) }
  }

  formatErrorResponse(code: string, message: string) {
    const codes: Record<string, number> = {
      INSUFFICIENT_FUNDS: 6,
      SESSION_EXPIRED: 5,
      PLAYER_BLOCKED: 5,
      INVALID_SIGNATURE: 3,
      DUPLICATE_TRANSACTION: 11,
      TRANSACTION_NOT_FOUND: 8,
      ALREADY_ROLLED_BACK: 9,
      INTERNAL_ERROR: 1,
      UNKNOWN_ACTION: 2,
    }
    return { status: codes[code] ?? 1, message }
  }
}
