/**
 * Prisma-реализация портов партнёрской программы (ТЗ ч.8 §5, Этап 5).
 *
 * Единственное место в модуле, где живёт Prisma (AI_DEVELOPMENT_RULES §3).
 * Маппинг DB row → domain entity изолирован здесь, application-слой работает
 * только с типами из domain/entities.
 */
import { randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { prisma } from '@casino/database'

import { AffiliateCodeGenerationError } from '../domain/errors/affiliate.errors'
import {
  type AffiliateAttributionRepository,
  type AffiliateClickRepository,
  type AffiliateCommissionRepository,
  type AffiliateCommissionTotals,
  type AffiliateRepository,
  type AttributionForCalc,
  type CreateAffiliateInput,
  type CreateAttributionInput,
  type CreateClickInput,
  type GameActivityRepository,
  type GameTotalsByCurrency,
  type LastClickSignals,
  type PeriodCommissionInput,
  type QualifyAttributionInput,
  type UpdateAffiliateAdminInput,
  type UpdateAffiliateSelfInput,
} from '../domain/repositories/affiliate.repository'

import type {
  AffiliateAttributionEntity,
  AffiliateAttributionStatus,
  AffiliateClickEntity,
  AffiliateCommissionEntity,
  AffiliateCommissionStatus,
  AffiliateEntity,
  AffiliateRejectReason,
  AffiliateStatus,
} from '../domain/entities/affiliate.entity'
import type { RevShareRate } from '../domain/value-objects/revshare-rate.value-object'
import type { Affiliate, Prisma, PrismaClient } from '@prisma/client'

/** Алфавит кода: без 0/O/1/I — исключаем визуально неоднозначные символы в публичной ссылке. */
const TRACKING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TRACKING_CODE_LENGTH = 8
const TRACKING_CODE_MAX_ATTEMPTS = 5

/** Decimal → строка без экспоненческой записи (Decimal.toString может вернуть "1e-9"). */
function toMoneyString(value: Prisma.Decimal | null | undefined): string {
  if (value === null || value === undefined) {
    return '0'
  }
  return value.toFixed(8)
}

/**
 * Сборка Prisma-`data` из частичного ввода админа.
 *
 * Вынесено из метода update: длинная цепочка spread-условий давала complexity 12
 * и делала сигнатуру метода нечитаемой. Правило «одна ответственность»
 * (CONVENTIONS §4.1) — здесь только маппинг, никакой логики.
 *
 * undefined-поля пропускаются, чтобы Prisma не затирал колонку значением null:
 * админ меняет ставку — не должен затирать website.
 */
function buildAdminUpdateData(input: UpdateAffiliateAdminInput): Prisma.AffiliateUpdateInput {
  const data: Prisma.AffiliateUpdateInput = {}
  const nullableTextFields = ['displayName', 'country', 'telegram', 'website'] as const
  for (const field of nullableTextFields) {
    const value = input[field]
    if (value !== undefined) {
      data[field] = value
    }
  }
  if (input.status !== undefined) {
    data.status = input.status
  }
  if (input.revshareRate !== undefined) {
    data.revshareRate = new Decimal(input.revshareRate)
  }
  if (input.payoutCurrency !== undefined) {
    data.payoutCurrency = input.payoutCurrency
  }
  if (input.suspendedReason !== undefined) {
    data.suspendedReason = input.suspendedReason
  }
  if (input.isAgreed !== undefined) {
    data.isAgreed = input.isAgreed
    data.agreedAt = input.isAgreed ? new Date() : null
  }
  if (input.trackingCode !== undefined) {
    data.trackingCode = input.trackingCode.toUpperCase()
  }
  return data
}

function toAffiliate(row: Affiliate): AffiliateEntity {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status as AffiliateStatus,
    trackingCode: row.trackingCode,
    displayName: row.displayName,
    country: row.country,
    telegram: row.telegram,
    website: row.website,
    trafficSources: Array.isArray(row.trafficSources) ? (row.trafficSources as string[]) : [],
    revshareRate: row.revshareRate.toFixed(4) as RevShareRate,
    payoutCurrency: row.payoutCurrency,
    totalEarned: toMoneyString(row.totalEarned),
    totalPaid: toMoneyString(row.totalPaid),
    isAgreed: row.isAgreed,
    agreedAt: row.agreedAt,
    suspendedReason: row.suspendedReason,
    lastClickAt: row.lastClickAt,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Репозиторий партнёров
// ─────────────────────────────────────────────────────────────────────────────
@Injectable()
export class PrismaAffiliateRepository implements AffiliateRepository {
  async findById(id: string): Promise<AffiliateEntity | null> {
    const row = await prisma.affiliate.findUnique({ where: { id } })
    return row ? toAffiliate(row) : null
  }

  async findByEmail(email: string): Promise<AffiliateEntity | null> {
    const row = await prisma.affiliate.findUnique({ where: { email: email.toLowerCase() } })
    return row ? toAffiliate(row) : null
  }

  async findByUserId(userId: string): Promise<AffiliateEntity | null> {
    const row = await prisma.affiliate.findUnique({ where: { userId } })
    return row ? toAffiliate(row) : null
  }

  async findByTrackingCode(code: string): Promise<AffiliateEntity | null> {
    const row = await prisma.affiliate.findUnique({ where: { trackingCode: code.toUpperCase() } })
    return row ? toAffiliate(row) : null
  }

  async create(input: CreateAffiliateInput): Promise<AffiliateEntity> {
    const row = await prisma.affiliate.create({
      data: {
        userId: input.userId,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        trackingCode: input.trackingCode.toUpperCase(),
        revshareRate: new Decimal(input.revshareRate),
        payoutCurrency: input.payoutCurrency,
        displayName: input.displayName ?? null,
        country: input.country ?? null,
        telegram: input.telegram ?? null,
        website: input.website ?? null,
        isAgreed: input.isAgreed,
        agreedAt: input.isAgreed ? new Date() : null,
      },
    })
    return toAffiliate(row)
  }

  async update(id: string, input: UpdateAffiliateAdminInput): Promise<AffiliateEntity> {
    const row = await prisma.affiliate.update({
      where: { id },
      data: buildAdminUpdateData(input),
    })
    return toAffiliate(row)
  }

  async updateSelf(id: string, input: UpdateAffiliateSelfInput): Promise<AffiliateEntity> {
    const row = await prisma.affiliate.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.telegram !== undefined ? { telegram: input.telegram } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
      },
    })
    return toAffiliate(row)
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await prisma.affiliate.update({ where: { id }, data: { passwordHash } })
  }

  async touchLastLogin(id: string): Promise<void> {
    await prisma.affiliate.update({ where: { id }, data: { lastLoginAt: new Date() } })
  }

  async touchLastClick(id: string, at: Date): Promise<void> {
    await prisma.affiliate.update({ where: { id }, data: { lastClickAt: at } })
  }

  async isTrackingCodeAvailable(code: string, excludeId?: string): Promise<boolean> {
    const existing = await prisma.affiliate.findUnique({
      where: { trackingCode: code.toUpperCase() },
      select: { id: true },
    })
    if (existing === null) {
      return true
    }
    return excludeId !== undefined && existing.id === excludeId
  }

  /**
   * Генерирует уникальный tracking_code.
   *
   * Retry по коллизиям: код публичный и короткий, вероятность совпадения невелика,
   * но при перегенерации кода в админке коллизия реальна. Уникальный индекс в БД
   * остаётся последним рубежом — здесь мы лишь снижаем вероятность P2002.
   */
  async generateUniqueTrackingCode(): Promise<string> {
    for (let attempt = 0; attempt < TRACKING_CODE_MAX_ATTEMPTS; attempt++) {
      const bytes = randomBytes(TRACKING_CODE_LENGTH)
      let code = ''
      for (let index = 0; index < TRACKING_CODE_LENGTH; index++) {
        code += TRACKING_CODE_ALPHABET[bytes[index]! % TRACKING_CODE_ALPHABET.length]
      }
      if (await this.isTrackingCodeAvailable(code)) {
        return code
      }
    }
    throw new AffiliateCodeGenerationError(TRACKING_CODE_MAX_ATTEMPTS)
  }

  async addEarned(id: string, amount: string): Promise<void> {
    await prisma.affiliate.update({
      where: { id },
      data: { totalEarned: { increment: new Decimal(amount) } },
    })
  }

  async list(args: {
    status?: AffiliateStatus
    search?: string
    page: number
    perPage: number
  }): Promise<{ items: AffiliateEntity[]; total: number }> {
    const where: Prisma.AffiliateWhereInput = {
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.search !== undefined && args.search !== ''
        ? {
            OR: [
              { email: { contains: args.search, mode: 'insensitive' } },
              { displayName: { contains: args.search, mode: 'insensitive' } },
              { trackingCode: { contains: args.search.toUpperCase(), mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.affiliate.findMany({
        where,
        skip: (args.page - 1) * args.perPage,
        take: args.perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.affiliate.count({ where }),
    ])
    return { items: rows.map(toAffiliate), total }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Репозиторий кликов
// ─────────────────────────────────────────────────────────────────────────────
@Injectable()
export class PrismaAffiliateClickRepository implements AffiliateClickRepository {
  async create(input: CreateClickInput): Promise<AffiliateClickEntity> {
    const row = await prisma.affiliateClick.create({
      data: {
        affiliateId: input.affiliateId,
        landingPath: input.landingPath,
        ipHash: input.ipHash,
        userAgent: input.userAgent ?? null,
        refererHost: input.refererHost ?? null,
        geoCountry: input.geoCountry ?? null,
        campaignId: input.campaignId ?? null,
        subId: input.subId ?? null,
      },
    })
    return {
      id: row.id.toString(),
      affiliateId: row.affiliateId,
      landingPath: row.landingPath,
      ipHash: row.ipHash,
      userAgent: row.userAgent,
      refererHost: row.refererHost,
      geoCountry: row.geoCountry,
      campaignId: row.campaignId,
      subId: row.subId,
      isConverted: row.isConverted,
      createdAt: row.createdAt,
    }
  }

  async markConverted(clickId: string): Promise<void> {
    await prisma.affiliateClick.update({
      where: { id: BigInt(clickId) },
      data: { isConverted: true },
    })
  }

  async findLastByAffiliate(affiliateId: string): Promise<LastClickSignals | null> {
    const row = await prisma.affiliateClick.findFirst({
      where: { affiliateId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ipHash: true, userAgent: true, createdAt: true },
    })
    if (row === null) {
      return null
    }
    return {
      ipHash: row.ipHash,
      userAgent: row.userAgent,
      clickId: row.id.toString(),
      createdAt: row.createdAt,
    }
  }

  /**
   * Правило F3: сколько квалифицированных игроков пришло с одного IP за окно.
   *
   * IP-сигнатура хранится только в affiliate_clicks.ip_hash (хеш, не сырой IP).
   * Атрибуция знает свой клик через click_id, поэтому связка строится Join'ом,
   * а не хранением дубля IP в affiliate_attributions.
   */
  async countQualifiedByIpHash(args: {
    affiliateId: string
    ipHash: string
    since: Date
  }): Promise<number> {
    return prisma.affiliateAttribution.count({
      where: {
        affiliateId: args.affiliateId,
        status: 'qualified',
        createdAt: { gte: args.since },
        click: { ipHash: args.ipHash },
      },
    })
  }

  async stats(args: {
    affiliateId: string
    from: Date
    to: Date
  }): Promise<{ total: number; converted: number }> {
    const where: Prisma.AffiliateClickWhereInput = {
      affiliateId: args.affiliateId,
      createdAt: { gte: args.from, lte: args.to },
    }
    const [total, converted] = await Promise.all([
      prisma.affiliateClick.count({ where }),
      prisma.affiliateClick.count({ where: { ...where, isConverted: true } }),
    ])
    return { total, converted }
  }

  async cleanupOlderThan(cutoff: Date): Promise<number> {
    const result = await prisma.affiliateClick.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
    return result.count
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Репозиторий атрибуций
// ─────────────────────────────────────────────────────────────────────────────
@Injectable()
export class PrismaAffiliateAttributionRepository implements AffiliateAttributionRepository {
  async findById(id: string): Promise<AffiliateAttributionEntity | null> {
    const row = await prisma.affiliateAttribution.findUnique({ where: { id } })
    return row ? toAttribution(row) : null
  }

  async findByPlayerId(playerId: string): Promise<AffiliateAttributionEntity | null> {
    const row = await prisma.affiliateAttribution.findUnique({ where: { playerId } })
    return row ? toAttribution(row) : null
  }

  async create(input: CreateAttributionInput): Promise<AffiliateAttributionEntity> {
    const row = await prisma.affiliateAttribution.create({
      data: {
        affiliateId: input.affiliateId,
        playerId: input.playerId,
        clickId:
          input.clickId !== undefined && input.clickId !== null ? BigInt(input.clickId) : null,
        status: input.status,
        isSelfReferral: input.isSelfReferral ?? false,
        rejectReason: input.rejectReason ?? null,
      },
    })
    return toAttribution(row)
  }

  async qualify(input: QualifyAttributionInput): Promise<AffiliateAttributionEntity> {
    const row = await prisma.affiliateAttribution.update({
      where: { id: input.id },
      data: {
        status: 'qualified',
        qualifiedAt: new Date(),
        firstDepositId: input.firstDepositId,
        firstDepositAt: input.firstDepositAt,
        totalDeposit: new Decimal(input.totalDeposit),
        depositCount: input.depositCount,
      },
    })
    return toAttribution(row)
  }

  async reject(id: string, reason: AffiliateRejectReason): Promise<AffiliateAttributionEntity> {
    const row = await prisma.affiliateAttribution.update({
      where: { id },
      data: { status: 'rejected', rejectReason: reason },
    })
    return toAttribution(row)
  }

  /**
   * Начисление депозита квалифицированной атрибуции.
   *
   * Возвращает qualified=false, если атрибуция ещё pending: депозит учтён
   * (total_deposit растёт всегда), но квалификация не пройдена — first_deposit_*
   * остаётся пустым, начислений не будет. Так депозит до KYC не «съедает»
   * будущую квалификацию.
   */
  async applyDeposit(args: {
    playerId: string
    paymentRequestId: string
    amount: string
    at: Date
  }): Promise<{ qualified: boolean; attributionId: string | null; isFirstDeposit: boolean }> {
    const attribution = await prisma.affiliateAttribution.findUnique({
      where: { playerId: args.playerId },
    })
    if (attribution === null) {
      return { qualified: false, attributionId: null, isFirstDeposit: false }
    }
    const isFirstDeposit = attribution.firstDepositAt === null
    await prisma.affiliateAttribution.update({
      where: { id: attribution.id },
      data: {
        totalDeposit: { increment: new Decimal(args.amount) },
        depositCount: { increment: 1 },
        ...(isFirstDeposit
          ? { firstDepositId: args.paymentRequestId, firstDepositAt: args.at }
          : {}),
      },
    })
    return {
      qualified: attribution.status === 'qualified',
      attributionId: attribution.id,
      isFirstDeposit,
    }
  }

  /**
   * Активно ли самоисключение игрока.
   *
   * user_settings принадлежит модулю users; здесь read-only проверка для
   * compliance-решения (ТЗ ч.8 §14.1). Аналогично ADR GAP-51: общий
   * Prisma-клиент вместо лишнего слоя-порта.
   */
  async isPlayerSelfExcluded(playerId: string): Promise<boolean> {
    const row = await prisma.userSettings.findUnique({
      where: { userId: playerId },
      select: { selfExcludedUntil: true },
    })
    if (row?.selfExcludedUntil === null || row?.selfExcludedUntil === undefined) {
      return false
    }
    return row.selfExcludedUntil > new Date()
  }

  async cancelForCompliance(
    id: string,
    reason: AffiliateRejectReason,
  ): Promise<AffiliateAttributionEntity> {
    const row = await prisma.affiliateAttribution.update({
      where: { id },
      data: { status: 'rejected', rejectReason: reason },
    })
    return toAttribution(row)
  }

  async listQualifiedForCalc(args: {
    until: Date
    page: number
    perPage: number
  }): Promise<{ items: AttributionForCalc[]; total: number }> {
    const where: Prisma.AffiliateAttributionWhereInput = {
      status: 'qualified',
      firstDepositAt: { lte: args.until },
    }
    const [rows, total] = await Promise.all([
      prisma.affiliateAttribution.findMany({
        where,
        skip: (args.page - 1) * args.perPage,
        take: args.perPage,
        orderBy: { firstDepositAt: 'asc' },
        select: { id: true, affiliateId: true, playerId: true },
      }),
      prisma.affiliateAttribution.count({ where }),
    ])
    return {
      items: rows.map((row) => ({
        attributionId: row.id,
        affiliateId: row.affiliateId,
        playerId: row.playerId,
      })),
      total,
    }
  }

  async list(args: {
    affiliateId?: string
    status?: AffiliateAttributionStatus
    page: number
    perPage: number
  }): Promise<{ items: AffiliateAttributionEntity[]; total: number }> {
    const where: Prisma.AffiliateAttributionWhereInput = {
      ...(args.affiliateId !== undefined ? { affiliateId: args.affiliateId } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.affiliateAttribution.findMany({
        where,
        skip: (args.page - 1) * args.perPage,
        take: args.perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.affiliateAttribution.count({ where }),
    ])
    return { items: rows.map(toAttribution), total }
  }
}

function toAttribution(row: {
  id: string
  affiliateId: string
  playerId: string
  clickId: bigint | null
  status: AffiliateAttributionStatus
  qualifiedAt: Date | null
  firstDepositId: string | null
  firstDepositAt: Date | null
  totalDeposit: Prisma.Decimal
  depositCount: number
  isSelfReferral: boolean
  rejectReason: string | null
  createdAt: Date
}): AffiliateAttributionEntity {
  return {
    id: row.id,
    affiliateId: row.affiliateId,
    playerId: row.playerId,
    clickId: row.clickId !== null ? row.clickId.toString() : null,
    status: row.status,
    qualifiedAt: row.qualifiedAt,
    firstDepositId: row.firstDepositId,
    firstDepositAt: row.firstDepositAt,
    totalDeposit: toMoneyString(row.totalDeposit),
    depositCount: row.depositCount,
    isSelfReferral: row.isSelfReferral,
    rejectReason: row.rejectReason as AffiliateRejectReason | null,
    createdAt: row.createdAt,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Репозиторий начислений
// ─────────────────────────────────────────────────────────────────────────────
@Injectable()
export class PrismaAffiliateCommissionRepository implements AffiliateCommissionRepository {
  async create(input: PeriodCommissionInput): Promise<AffiliateCommissionEntity> {
    const row = await prisma.affiliateCommission.create({
      data: {
        affiliateId: input.affiliateId,
        playerId: input.playerId,
        attributionId: input.attributionId ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: input.currency,
        betSum: new Decimal(input.betSum),
        winSum: new Decimal(input.winSum),
        rollbackSum: new Decimal(input.rollbackSum),
        bonusSum: new Decimal(input.bonusSum),
        providerFeeSum: new Decimal(input.providerFeeSum),
        ggrAmount: new Decimal(input.ggrAmount),
        ngrAmount: new Decimal(input.ngrAmount),
        revshareRate: new Decimal(input.revshareRate),
        commissionAmount: new Decimal(input.commissionAmount),
        status: 'pending',
      },
    })
    return toCommission(row)
  }

  async findById(id: string): Promise<AffiliateCommissionEntity | null> {
    const row = await prisma.affiliateCommission.findUnique({ where: { id } })
    return row ? toCommission(row) : null
  }

  async markCredited(id: string, ledgerEntryId: string, at: Date): Promise<void> {
    await prisma.affiliateCommission.update({
      where: { id },
      data: { status: 'approved', creditedAt: at, ledgerEntryId },
    })
  }

  async markCancelled(id: string): Promise<AffiliateCommissionEntity> {
    const row = await prisma.affiliateCommission.update({
      where: { id },
      data: { status: 'cancelled' },
    })
    return toCommission(row)
  }

  async listCreditableByPlayer(args: {
    playerId: string
    statuses: AffiliateCommissionStatus[]
  }): Promise<AffiliateCommissionEntity[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: { playerId: args.playerId, status: { in: args.statuses } },
      orderBy: { periodStart: 'asc' },
    })
    return rows.map(toCommission)
  }

  async findByPeriod(args: {
    affiliateId: string
    playerId: string
    periodStart: Date
    currency: string
  }): Promise<AffiliateCommissionEntity | null> {
    const row = await prisma.affiliateCommission.findUnique({
      where: {
        affiliateId_playerId_periodStart_currency: {
          affiliateId: args.affiliateId,
          playerId: args.playerId,
          periodStart: args.periodStart,
          currency: args.currency,
        },
      },
    })
    return row ? toCommission(row) : null
  }

  async totals(args: {
    affiliateId: string
    from?: Date
    to?: Date
  }): Promise<AffiliateCommissionTotals> {
    const where: Prisma.AffiliateCommissionWhereInput = {
      affiliateId: args.affiliateId,
      status: 'approved',
      ...(args.from !== undefined || args.to !== undefined
        ? {
            periodStart: {
              ...(args.from !== undefined ? { gte: args.from } : {}),
              ...(args.to !== undefined ? { lte: args.to } : {}),
            },
          }
        : {}),
    }
    const [aggregate, commissionsCount, players] = await Promise.all([
      prisma.affiliateCommission.aggregate({
        where,
        _sum: { commissionAmount: true, ngrAmount: true, ggrAmount: true },
      }),
      prisma.affiliateCommission.count({ where }),
      prisma.affiliateCommission.findMany({
        where,
        select: { playerId: true },
        distinct: ['playerId'],
      }),
    ])
    return {
      totalCommission: (aggregate._sum.commissionAmount ?? new Decimal(0)).toFixed(8),
      totalNgr: (aggregate._sum.ngrAmount ?? new Decimal(0)).toFixed(8),
      totalGgr: (aggregate._sum.ggrAmount ?? new Decimal(0)).toFixed(8),
      playersCount: players.length,
      commissionsCount,
    }
  }

  async list(args: {
    affiliateId?: string
    playerId?: string
    status?: AffiliateCommissionStatus
    from?: Date
    to?: Date
    page: number
    perPage: number
  }): Promise<{ items: AffiliateCommissionEntity[]; total: number }> {
    const where: Prisma.AffiliateCommissionWhereInput = {
      ...(args.affiliateId !== undefined ? { affiliateId: args.affiliateId } : {}),
      ...(args.playerId !== undefined ? { playerId: args.playerId } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.from !== undefined || args.to !== undefined
        ? {
            periodStart: {
              ...(args.from !== undefined ? { gte: args.from } : {}),
              ...(args.to !== undefined ? { lte: args.to } : {}),
            },
          }
        : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.affiliateCommission.findMany({
        where,
        skip: (args.page - 1) * args.perPage,
        take: args.perPage,
        orderBy: { periodStart: 'desc' },
      }),
      prisma.affiliateCommission.count({ where }),
    ])
    return { items: rows.map(toCommission), total }
  }
}

function toCommission(row: {
  id: string
  affiliateId: string
  playerId: string
  attributionId: string | null
  periodStart: Date
  periodEnd: Date
  currency: string
  betSum: Prisma.Decimal
  winSum: Prisma.Decimal
  rollbackSum: Prisma.Decimal
  bonusSum: Prisma.Decimal
  providerFeeSum: Prisma.Decimal
  ggrAmount: Prisma.Decimal
  ngrAmount: Prisma.Decimal
  revshareRate: Prisma.Decimal
  commissionAmount: Prisma.Decimal
  status: AffiliateCommissionStatus
  creditedAt: Date | null
  ledgerEntryId: string | null
  createdAt: Date
}): AffiliateCommissionEntity {
  return {
    id: row.id,
    affiliateId: row.affiliateId,
    playerId: row.playerId,
    attributionId: row.attributionId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    currency: row.currency,
    betSum: toMoneyString(row.betSum),
    winSum: toMoneyString(row.winSum),
    rollbackSum: toMoneyString(row.rollbackSum),
    bonusSum: toMoneyString(row.bonusSum),
    providerFeeSum: toMoneyString(row.providerFeeSum),
    ggrAmount: toMoneyString(row.ggrAmount),
    ngrAmount: toMoneyString(row.ngrAmount),
    revshareRate: row.revshareRate.toFixed(4) as RevShareRate,
    commissionAmount: toMoneyString(row.commissionAmount),
    status: row.status,
    creditedAt: row.creditedAt,
    ledgerEntryId: row.ledgerEntryId,
    createdAt: row.createdAt,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Источники игровых сумм (ADR GAP-51 — read-only доступ, как у referrals)
// ─────────────────────────────────────────────────────────────────────────────
@Injectable()
export class PrismaGameActivityRepository implements GameActivityRepository {
  /**
   * Σ bet/win/rollback по игроку за период, сгруппированные по валютам.
   *
   * Суммирование делает PostgreSQL (Decimal), а не JS: перебор строк в Node
   * означал бы потерю точности и загрузку памяти на игроков с тысячами ставок.
   * Индекс [userId, type, createdAt] покрывает этот запрос.
   */
  async sumGameActivity(args: {
    playerId: string
    from: Date
    to: Date
  }): Promise<GameTotalsByCurrency> {
    const rows = await prisma.gameTransaction.groupBy({
      by: ['type', 'currency'],
      where: { userId: args.playerId, createdAt: { gte: args.from, lte: args.to } },
      _sum: { amount: true },
      orderBy: [{ type: 'asc' }, { currency: 'asc' }],
    })

    const bets = new Map<string, string>()
    const wins = new Map<string, string>()
    const rollbacks = new Map<string, string>()
    // Мапы берутся по ссылке: перебор строк меняет их на месте, иначе
    // пришлось бы создавать копии под каждый groupBy.
    const targetByType: Record<string, Map<string, string>> = {
      bet: bets,
      win: wins,
      rollback: rollbacks,
    }
    for (const row of rows) {
      const target = targetByType[row.type]
      if (target === undefined) {
        continue
      }
      target.set(row.currency, (row._sum.amount ?? new Decimal(0)).toFixed(8))
    }
    return { bets, wins, rollbacks }
  }

  /**
   * Σ бонусов игрока за период по валютам (ledger_entries.type = 'BONUS').
   *
   * ⚠️ ДЕНЕЖНЫЙ КОНТУР — ТОЛЬКО ЧТЕНИЕ (GAP-62 проверено, нарушений нет):
   * здесь читаются `wallet_accounts` (id+currency игрока) и `ledger_entries`
   * ( сумма `_sum(amount)` по типу BONUS). Ни INSERT, ни UPDATE, ни DELETE над
   * чужими таблицами в этом методе нет — деньги начисляются исключительно через
   * `WalletFacade` (см. `credit-commission.use-case.ts`), это единственный путь
   * в ledger из affiliate.
   *
   * ЗАЧЕМ ЭТО ВООБЩЕ ЧИТАЕТСЯ: бонусы вычитаются из NGR (NGR = GGR − бонусы −
   * комиссии провайдера, ТЗ ч.8 §7), то есть это компонент агрегата партнёрских
   * начислений, а не доступ к балансу игрока. Read-only доступ к чужим таблицам
   * через общий Prisma-клиент — принятое решение репозитория (ADR GAP-51,
   * пересматривается при выносе wallet в отдельный сервис).
   *
   * ВАЖНО: у ledger_entries НЕТ поля currency — валюта лежит в
   * wallet_accounts.currency, а ledger ссылается на кошелёк через
   * wallet_account_id. Prisma groupBy не умеет группировать по полю
   * связанной таблицы, поэтому схема «сгруппировать по кошелькам, затем
   * разложить по валютам» — это два запроса, а не N+1 на каждый кошелёк.
   *
   * Порядок именно такой: сначала кошельки игрока (их единицы), затем один
   * aggregate по ledger с фильтром по этим кошелькам.
   */
  async sumPlayerBonuses(args: {
    playerId: string
    from: Date
    to: Date
  }): Promise<Map<string, string>> {
    const wallets = await prisma.walletAccount.findMany({
      where: { userId: args.playerId },
      select: { id: true, currency: true },
    })
    if (wallets.length === 0) {
      return new Map<string, string>()
    }
    const currencyByWalletId = new Map<string, string>(
      wallets.map((wallet) => [wallet.id, wallet.currency]),
    )
    const aggregated = await prisma.ledgerEntry.groupBy({
      by: ['walletAccountId'],
      where: {
        walletAccountId: { in: wallets.map((wallet) => wallet.id) },
        type: 'BONUS',
        createdAt: { gte: args.from, lte: args.to },
      },
      _sum: { amount: true },
      orderBy: { walletAccountId: 'asc' },
    })

    const result = new Map<string, string>()
    for (const row of aggregated) {
      const currency = currencyByWalletId.get(row.walletAccountId)
      if (currency === undefined) {
        continue
      }
      const amount = row._sum.amount ?? new Decimal(0)
      result.set(currency, amount.toFixed(8))
    }
    return result
  }
}

export type { PrismaClient }
