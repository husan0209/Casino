import { createHmac } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { describe, it, expect, vi } from 'vitest'

import {
  CALLBACK_MESSAGE_BUILDERS,
  GitslotparkProviderAdapter,
} from '../src/modules/casino/infrastructure/providers/gitslotpark/gitslotpark.adapter'

/**
 * GAP-43: фиксирует **текущий** контракт подписи GitSlotPark до сверки с менеджером.
 *
 * Смысл теста: после сверки с менеджером правится только `CALLBACK_MESSAGE_BUILDERS`
 * в `gitslotpark.adapter.ts` (порядок конкатенации полей), а спек сразу показывает,
 * что именно изменилось: либо «expected signature» для каждой операции совпадает
 * с реальной подписью (контракт подтверждён), либо diff виден в CI (контракт иной).
 *
 * Сейчас тест использует фиктивный SECRET_KEY — это безопасно (боевые ключи не нужны),
 * HMAC-SHA256 детерминирован, и контракт `verifyCallback`/`formatErrorResponse`/
 * `parseCallback` не зависит от реального провайдера.
 */

const SECRET = 'test_secret_gitslotpark_deterministic_only'
const AGENT = 'AGENT42'
const API_TOKEN = 'API_TOKEN_LOCAL'

function configWith(values: Record<string, string>): ConfigService {
  const config = new ConfigService()
  vi.spyOn(config, 'get').mockImplementation(((key: string) => values[key]) as never)
  return config
}

/** Провайдер настроен: три обязательных ключа на месте. */
function buildConfig(): ConfigService {
  return configWith({
    GITSLOTPARK_AGENT_ID: AGENT,
    GITSLOTPARK_API_TOKEN: API_TOKEN,
    GITSLOTPARK_SECRET_KEY: SECRET,
  })
}

/** Ни одного GITSLOTPARK_* ключа — именно этот случай обязан быть fail-closed. */
function buildConfigWithoutKeys(): ConfigService {
  return configWith({})
}

/**
 * `CALLBACK_MESSAGE_BUILDERS` — `Record<string, …>`, поэтому индекс по строковому ключу
 * даёт `| undefined` (noUncheckedIndexedAccess). Провал — явно, а не «is not a function».
 */
function builder(op: string): (body: Record<string, unknown>) => string {
  const fn = CALLBACK_MESSAGE_BUILDERS[op]
  if (!fn) {
    throw new Error(`gitslotpark.adapter: нет билдера подписи для «${op}»`)
  }
  return fn
}

/** Локальный эталон HMAC — должен совпадать с тем, что делает адаптер. */
function expectedSign(message: string): string {
  return createHmac('sha256', SECRET).update(message).digest('hex').toUpperCase()
}

describe('GAP-43 GitslotparkProviderAdapter', () => {
  describe('CALLBACK_MESSAGE_BUILDERS (фиксирует порядок полей подписи)', () => {
    // Эти ожидаемые значения — **эталон**, с которым сверяется GitSlotPark при
    // выдаче боевых ключей (см. docs/IMPLEMENTATION_GAPS.md → GAP-43). Если
    // менеджер подтвердит — оставляем как есть; если скажет «у нас порядок X»
    // — фикс в адаптере ИЛИ в этом спеке, но НЕ односторонне.

    const AMT = (v: unknown) => Number(v ?? 0).toFixed(2)

    it('getbalance: agentID + userID', () => {
      const message = builder('getbalance')({ agentID: AGENT, userID: 'u-1' })
      expect(message).toBe(`${AGENT}u-1`)
    })

    it('withdraw: agentID + userID + AMT(amount) + transactionID + roundID', () => {
      const body = {
        agentID: AGENT,
        userID: 'u-1',
        amount: '10',
        transactionID: 'tx-w-1',
        roundID: 'r-1',
      }
      const message = builder('withdraw')(body)
      expect(message).toBe(`${AGENT}u-1${AMT(body.amount)}${body.transactionID}${body.roundID}`)
      // sanity: ожидаемая подпись детерминирована
      expect(expectedSign(message)).toMatch(/^[A-F0-9]{64}$/)
    })

    it('deposit: agentID + userID + AMT(amount) + refTransactionID + transactionID + roundID', () => {
      const body = {
        agentID: AGENT,
        userID: 'u-1',
        amount: '10',
        refTransactionID: 'tx-w-1',
        transactionID: 'tx-d-1',
        roundID: 'r-1',
      }
      const message = builder('deposit')(body)
      expect(message).toBe(
        `${AGENT}u-1${AMT(body.amount)}${body.refTransactionID}${body.transactionID}${body.roundID}`,
      )
      expect(expectedSign(message)).toMatch(/^[A-F0-9]{64}$/)
    })

    it('betwin: agentID + userID + AMT(betAmount) + AMT(winAmount) + transactionID + roundID', () => {
      const body = {
        agentID: AGENT,
        userID: 'u-1',
        betAmount: '10',
        winAmount: '25',
        transactionID: 'tx-bw-1',
        roundID: 'r-1',
      }
      const message = builder('betwin')(body)
      expect(message).toBe(
        `${AGENT}u-1${AMT(body.betAmount)}${AMT(body.winAmount)}${body.transactionID}${body.roundID}`,
      )
      expect(expectedSign(message)).toMatch(/^[A-F0-9]{64}$/)
    })

    it('rollbacktransaction: agentID + userID + refTransactionID', () => {
      const body = { agentID: AGENT, userID: 'u-1', refTransactionID: 'tx-r-1' }
      const message = builder('rollbacktransaction')(body)
      expect(message).toBe(`${AGENT}u-1${body.refTransactionID}`)
      expect(expectedSign(message)).toMatch(/^[A-F0-9]{64}$/)
    })

    it('AMT: ровно 2 знака после точки для amount/betAmount/winAmount', () => {
      expect(AMT(10)).toBe('10.00')
      expect(AMT('10')).toBe('10.00')
      expect(AMT(0)).toBe('0.00')
      expect(AMT(undefined)).toBe('0.00')
      expect(AMT(null)).toBe('0.00')
    })
  })

  describe('verifyCallback', () => {
    function buildSignedBody(
      op: string,
      extra: Record<string, unknown>,
    ): {
      headers: Record<string, string>
      body: Record<string, unknown>
    } {
      const body = { agentID: AGENT, userID: 'u-1', ...extra }
      const message = builder(op)(body)
      const sign = expectedSign(message)
      return { headers: { 'x-gsp-op': op }, body: { ...body, sign } }
    }

    it('верная подпись → true', () => {
      const adapter = new GitslotparkProviderAdapter(buildConfig())
      const { headers, body } = buildSignedBody('withdraw', {
        amount: '10',
        transactionID: 'tx-w-1',
        roundID: 'r-1',
      })
      expect(adapter.verifyCallback(headers, body)).toBe(true)
    })

    it('неверная подпись → false', () => {
      const adapter = new GitslotparkProviderAdapter(buildConfig())
      const { headers, body } = buildSignedBody('withdraw', {
        amount: '10',
        transactionID: 'tx-w-1',
        roundID: 'r-1',
      })
      const tampered = { ...body, sign: 'A'.repeat(64) }
      expect(adapter.verifyCallback(headers, tampered)).toBe(false)
    })

    it('подпись в lowercase → true (нормализация в signatureMatches)', () => {
      const adapter = new GitslotparkProviderAdapter(buildConfig())
      const { headers, body } = buildSignedBody('getbalance', {})
      const lower = { ...body, sign: String(body.sign).toLowerCase() }
      expect(adapter.verifyCallback(headers, lower)).toBe(true)
    })

    it('неизвестный x-gsp-op → false', () => {
      const adapter = new GitslotparkProviderAdapter(buildConfig())
      const { headers, body } = buildSignedBody('getbalance', {})
      expect(adapter.verifyCallback({ ...headers, 'x-gsp-op': 'unknownop' }, body)).toBe(false)
    })

    it('payload.sign отсутствует → false', () => {
      const adapter = new GitslotparkProviderAdapter(buildConfig())
      const headers = { 'x-gsp-op': 'getbalance' }
      const body = { agentID: AGENT, userID: 'u-1' }
      expect(adapter.verifyCallback(headers, body)).toBe(false)
    })

    it('без ключей → false БЕЗ исключения (fail-closed)', () => {
      // С ВЕРНОЙ подписью: те же headers/body при настроенных ключах дают true
      // (см. предыдущий тест), значит падение здесь — именно из-за отсутствия ключей,
      // а не из-за несовпадения HMAC.
      const adapter = new GitslotparkProviderAdapter(buildConfigWithoutKeys())
      const { headers, body } = buildSignedBody('getbalance', {})
      expect(adapter.verifyCallback(headers, body)).toBe(false)
    })

    it('body === undefined → false (защита от падения)', () => {
      const adapter = new GitslotparkProviderAdapter(buildConfig())
      expect(adapter.verifyCallback({ 'x-gsp-op': 'getbalance' }, undefined)).toBe(false)
    })
  })

  describe('parseCallback', () => {
    const adapter = new GitslotparkProviderAdapter(buildConfig())

    it('withdraw → action=bet', () => {
      const r = adapter.parseCallback(
        { 'x-gsp-op': 'withdraw' },
        {
          userID: 'u-1',
          amount: '10',
          transactionID: 'tx-w-1',
          roundID: 'r-1',
        },
      )
      expect(r.action).toBe('bet')
      expect(r.playerToken).toBe('uid:u-1')
      expect(r.playerId).toBe('u-1')
      expect(r.betAmount).toBe('10')
      expect(r.transactionId).toBe('tx-w-1')
      expect(r.roundId).toBe('r-1')
    })

    it('betwin → action=win, betAmount из betAmount, winAmount из winAmount', () => {
      const r = adapter.parseCallback(
        { 'x-gsp-op': 'betwin' },
        {
          userID: 'u-1',
          betAmount: '10',
          winAmount: '25',
          transactionID: 'tx-bw-1',
          roundID: 'r-1',
        },
      )
      expect(r.action).toBe('win')
      expect(r.betAmount).toBe('10')
      expect(r.winAmount).toBe('25')
    })

    it('deposit → action=win, winAmount из amount (fallback)', () => {
      const r = adapter.parseCallback(
        { 'x-gsp-op': 'deposit' },
        {
          userID: 'u-1',
          amount: '50',
          transactionID: 'tx-d-1',
          roundID: 'r-1',
        },
      )
      expect(r.action).toBe('win')
      expect(r.winAmount).toBe('50')
    })

    it('rollbacktransaction → action=rollback, rollbackTransactionId из refTransactionID', () => {
      const r = adapter.parseCallback(
        { 'x-gsp-op': 'rollbacktransaction' },
        {
          userID: 'u-1',
          refTransactionID: 'tx-r-1',
          transactionID: 'tx-new-1',
        },
      )
      expect(r.action).toBe('rollback')
      expect(r.rollbackTransactionId).toBe('tx-r-1')
      expect(r.transactionId).toBe('tx-new-1')
    })

    it('getbalance → action=balance', () => {
      const r = adapter.parseCallback({ 'x-gsp-op': 'getbalance' }, { userID: 'u-1' })
      expect(r.action).toBe('balance')
    })

    it('playerToken === "uid:<userID>" — seamless-модель', () => {
      const r = adapter.parseCallback({ 'x-gsp-op': 'getbalance' }, { userID: '42' })
      expect(r.playerToken).toBe('uid:42')
    })

    it('неизвестный op → action=balance (без падения)', () => {
      const r = adapter.parseCallback({ 'x-gsp-op': 'unknownop' }, { userID: 'u-1' })
      expect(r.action).toBe('balance')
    })
  })

  describe('formatErrorResponse', () => {
    const adapter = new GitslotparkProviderAdapter(buildConfig())

    it('INSUFFICIENT_FUNDS → status 6', () => {
      expect(adapter.formatErrorResponse('INSUFFICIENT_FUNDS', 'no funds')).toEqual({
        status: 6,
        message: 'no funds',
      })
    })
    it('TRANSACTION_NOT_FOUND → status 8', () => {
      expect(adapter.formatErrorResponse('TRANSACTION_NOT_FOUND', 'tx gone')).toEqual({
        status: 8,
        message: 'tx gone',
      })
    })
    it('ALREADY_ROLLED_BACK → status 9', () => {
      expect(adapter.formatErrorResponse('ALREADY_ROLLED_BACK', 'dup rb')).toEqual({
        status: 9,
        message: 'dup rb',
      })
    })
    it('DUPLICATE_TRANSACTION → status 11', () => {
      expect(adapter.formatErrorResponse('DUPLICATE_TRANSACTION', 'dup tx')).toEqual({
        status: 11,
        message: 'dup tx',
      })
    })
    it('INVALID_SIGNATURE → status 3', () => {
      expect(adapter.formatErrorResponse('INVALID_SIGNATURE', 'bad sig')).toEqual({
        status: 3,
        message: 'bad sig',
      })
    })
    it('SESSION_EXPIRED → status 5', () => {
      expect(adapter.formatErrorResponse('SESSION_EXPIRED', 'expired')).toEqual({
        status: 5,
        message: 'expired',
      })
    })
    it('PLAYER_BLOCKED → status 5', () => {
      expect(adapter.formatErrorResponse('PLAYER_BLOCKED', 'banned')).toEqual({
        status: 5,
        message: 'banned',
      })
    })
    it('неизвестный код → status 1 (fallback)', () => {
      expect(adapter.formatErrorResponse('WAT', 'wat')).toEqual({ status: 1, message: 'wat' })
    })
  })

  describe('formatSuccessResponse', () => {
    const adapter = new GitslotparkProviderAdapter(buildConfig())

    it('баланс форматируется с 2 знаками (Number(...).toFixed(2) → string)', () => {
      expect(adapter.formatSuccessResponse('1500')).toEqual({ status: 0, balance: '1500.00' })
      // ⚠️ Замечание: внутри адаптера используется Number(...).toFixed(2) вместо
      // money.* из shared-utils. Это сознательный компромисс: контракт GitSlotPark
      // ждёт JSON-число с 2 знаками после точки (status 0 + balance как строка
      // из toFixed). money.multiply тут не применим — это ответ провайдеру, не
      // wallet-операция. Тест зафиксирован для отслеживания drift'а.
      expect(adapter.formatSuccessResponse('1500.5')).toEqual({ status: 0, balance: '1500.50' })
    })

    it('status всегда 0 (success по таблице GitSlotPark)', () => {
      expect(adapter.formatSuccessResponse('0').status).toBe(0)
      expect(adapter.formatSuccessResponse('1000000.99').status).toBe(0)
    })
  })
})
