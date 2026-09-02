import { createHmac, timingSafeEqual } from 'crypto'

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import {
  type GameProviderAdapter,
  type LaunchParams,
  type ParsedProviderCallback,
  type ProviderGameRow,
} from '@modules/casino/domain/provider-adapter.interface'
import { PaymentProviderNotConfiguredError } from '@modules/payments/infrastructure/clients/rukassa.client'

const has = (v: unknown): boolean => v !== null && v !== undefined

/** Элемент каталога агрегатора — внешний API без контракта, читаем по индексу. */
type RawGameRow = Record<string, unknown>
/** Конверт списка игр: массив, {games: []} или {data: []} — зависит от версии API. */
type GameListEnvelope = RawGameRow[] | { games?: RawGameRow[]; data?: RawGameRow[] }

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
const AMT = (v: unknown) => Number(v ?? 0).toFixed(2)

/** Первое поле с фактическим значением (undefined/пусто пропускаются). */
function firstPresent(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (has(body[k])) {
      return String(body[k])
    }
  }
  return undefined
}

/** Постоянное сравнение подписи (timing-safe) — given от провайдера, expected наш HMAC. */
function signatureMatches(givenRaw: string, expected: string): boolean {
  const given = givenRaw.toUpperCase()
  const a = Buffer.from(given, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Первое непустое поле из перечня (внешний контракт без схемы). */
function pick(g: RawGameRow, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = g[k]
    if (v !== null && v !== undefined) {
      return v
    }
  }
  return undefined
}

/** Нормализация строки каталога агрегатора (внешний контракт без схемы). */
function mapProviderGame(g: RawGameRow): ProviderGameRow {
  const isLive = g['type'] === 'live'
  const rtp = pick(g, 'rtp')
  return {
    externalGameId: String(pick(g, 'gameid', 'id', 'game_id')),
    name: String(pick(g, 'name', 'gameName') ?? ''),
    type: isLive ? 'live_roulette' : 'slot',
    category: isLive ? 'live_casino' : 'slots',
    thumbnailUrl: pick(g, 'image', 'thumbnail') as string | undefined,
    hasDemo: Boolean(pick(g, 'demo', 'freespin')),
    rtp: rtp ? Number(rtp) : undefined,
    metadata: g,
  }
}

/**
 * Порядок конкатенации полей подписи по операциям (Withdraw/Deposit/BetWin).
 * ⚠️ Сверить с менеджером GitSlotPark при выдаче боевых ключей.
 */
const CALLBACK_MESSAGE_BUILDERS: Record<string, (body: Record<string, unknown>) => string> = {
  getbalance: (b) => `${b.agentID}${b.userID}`,
  withdraw: (b) => `${b.agentID}${b.userID}${AMT(b.amount)}${b.transactionID}${b.roundID}`,
  deposit: (b) =>
    `${b.agentID}${b.userID}${AMT(b.amount)}${b.refTransactionID ?? ''}${b.transactionID ?? ''}${b.roundID ?? ''}`,
  betwin: (b) =>
    `${b.agentID}${b.userID}${AMT(b.betAmount)}${AMT(b.winAmount)}${b.transactionID}${b.roundID}`,
  rollbacktransaction: (b) => `${b.agentID}${b.userID}${b.refTransactionID}`,
}

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- external PSP payload (GitSlotPark), defensive parsing of unknown JSON shape
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
    // Внешний API без контракта — ответ читается через unknown-индексацию с фолбэками
    const d = (await res.json()) as GameListEnvelope
    const list: RawGameRow[] = Array.isArray(d) ? d : (d.games ?? d.data ?? [])
    return list.map(mapProviderGame)
  }

  /**
   * Проверка подписи. op приходит в заголовке x-gsp-op (ставит контроллер из пути).
   * ⚠️ Порядки конкатенации Withdraw/Deposit/BetWin сверить с менеджером GitSlotPark
   * при выдаче боевых ключей (в доках приведён общий принцип + один пример).
   */
  verifyCallback(headers: Record<string, string>, body: unknown): boolean {
    try {
      this.creds()
      const op = String(headers['x-gsp-op'] || '').toLowerCase()
      const build = CALLBACK_MESSAGE_BUILDERS[op]
      if (!build) {
        return false
      }
      const expected = this.sign([build(body)])
      return signatureMatches(String(body.sign ?? ''), expected)
    } catch (e) {
      this.logger.warn(`verifyCallback failed: ${errorMessage(e)}`)
      return false
    }
  }

  parseCallback(_headers: Record<string, string>, body: Record<string, unknown>): ParsedProviderCallback {
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
      betAmount: firstPresent(body, 'amount', 'betAmount'),
      winAmount: firstPresent(body, 'winAmount', 'amount'),
      roundId: firstPresent(body, 'roundID'),
      transactionId: firstPresent(body, 'transactionID'),
      rollbackTransactionId: firstPresent(body, 'refTransactionID'),
      gameId: firstPresent(body, 'gameID'),
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
