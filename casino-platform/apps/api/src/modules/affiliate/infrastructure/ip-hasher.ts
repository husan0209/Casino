/**
 * Хеширование IP для антифрод-сигнатур (ТЗ ч.8 §6.2, §16).
 *
 * ПРИНЦИП: сырой IP не попадает в БД НИКОГДА. В affiliate_clicks хранится
 * только SHA-256(ip + соль). Требование — GDPR/152-ФЗ: данные, позволяющие
 * идентифицировать пользователя, обрабатываются минимально.
 *
 * Соль — INTERNAL_API_SECRET. Без соли хеш подбирается перебором за секунды
 * (диапазон IPv4 всего 2^32), что делает хранение бессмысленным.
 */
import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import type { IpFingerprinter } from '../domain/repositories/affiliate.repository'

/** Максимальная длина сохраняемого User-Agent — защита от переполнения колонки. */
const MAX_USER_AGENT_LENGTH = 255
/** Максимальная длина host из Referer. */
const MAX_HOST_LENGTH = 255

@Injectable()
export class IpHasher implements IpFingerprinter {
  private readonly salt: string

  constructor() {
    this.salt = process.env['INTERNAL_API_SECRET'] ?? 'affiliate-local-dev-salt'
  }

  /**
   * SHA-256 от нормализованного IP с солью.
   *
   * Нормализация: IPv4-mapped-IPv6 (`::ffff:1.2.3.4`) приводится к `1.2.3.4`,
   * иначе один и тот же клиент дал бы два разных хеша и обошёл бы антифрод.
   *
   * Параметр шире, чем у порта (`string | null | undefined`): контроллеры
   * отдают `req.ip`, который в Express может быть undefined. Реализация
   * нормализует мусор в стабильный хеш пустого значения, чтобы в колонке
   * не оказалось NULL и F1/F2 не падали бы на сравнении.
   */
  hash(ip: string | undefined | null): string {
    const normalized = normalizeIp(ip)
    return createHash('sha256').update(`${normalized}${this.salt}`).digest('hex')
  }
}

/** Приводит IP к каноническому виду; null/undefined → пустая строка (хеш «пустого»). */
export function normalizeIp(ip: string | undefined | null): string {
  if (ip === undefined || ip === null) {
    return ''
  }
  const trimmed = ip.trim()
  const ipv4Mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed)
  if (ipv4Mapped?.[1] !== undefined) {
    return ipv4Mapped[1]
  }
  return trimmed
}

/** Усекает UA до длины колонки. */
export function sanitizeUserAgent(userAgent: string | undefined | null): string | null {
  if (userAgent === undefined || userAgent === null || userAgent.trim() === '') {
    return null
  }
  return userAgent.slice(0, MAX_USER_AGENT_LENGTH)
}

/**
 * Достаёт ТОЛЬКО host из Referer.
 *
 * Ссылка целиком не нужна для аналитики и может содержать query с токенами,
 * поэтому в БЦ уходит только домен.
 */
export function extractRefererHost(referer: string | undefined | null): string | null {
  if (referer === undefined || referer === null || referer.trim() === '') {
    return null
  }
  try {
    return new URL(referer).host.slice(0, MAX_HOST_LENGTH)
  } catch {
    return null
  }
}
