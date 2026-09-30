/**
 * Admin-API партнёрской программы (UC-AFF-17..25; ТЗ ч.8 §10.3, §11).
 *
 * РАЗДЕЛЕНИЕ РОЛЕЙ. Глобальные настройки (ставка по умолчанию, пороги, флаги)
 * и ручной запуск расчёта — только superadmin: это напрямую влияет на P&L.
 * Индивидуальная ставка партнёра и санкции — admin.
 *
 * АУДИТ. Каждое изменение ставки/статуса пишется в audit_logs через
 * AuditLogService. Для регулятора важно не «сколько заплатили», а «когда и
 * на каком основании изменили условия» (ТЗ ч.8 §3.7).
 *
 * СПИСОК И НАЧИСЛЕНИЯ отдаются в snake_case — как у соседних admin-контроллеров
 * (см. ReferralsAdminController), чтобы фронт не держал две схемы.
 */
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { Decimal } from 'decimal.js'
import { type Request } from 'express'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'

import { AuditLogService } from '../../../admin/application/audit-log.service'
import { AdminAuthGuard } from '../../../admin/presentation/admin-auth.guard'
import { Roles, RolesGuard } from '../../../auth/presentation/guards/roles.guard'
import { AffiliateSettingsService } from '../../application/affiliate-settings.service'
import { AffiliateDailyRunUseCase } from '../../application/use-cases/affiliate-daily-run.use-case'
import { ClawbackPlayerCommissionsUseCase } from '../../application/use-cases/clawback-player-commissions.use-case'
import { AffiliateNotFoundError } from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_ATTRIBUTION_REPOSITORY,
  AFFILIATE_COMMISSION_REPOSITORY,
  AFFILIATE_REPOSITORY,
  type AffiliateAttributionRepository,
  type AffiliateCommissionRepository,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'
import {
  parseRevShareRate,
  revShareRateToPercent,
} from '../../domain/value-objects/revshare-rate.value-object'
import {
  AffiliateListQuerySchema,
  CommissionListQuerySchema,
  CreateAffiliateAdminSchema,
  RunDailySchema,
  UpdateAffiliateAdminSchema,
  UpdateAffiliateSettingSchema,
  type AffiliateListQueryDto,
  type CommissionListQueryDto,
  type CreateAffiliateAdminDto,
  type UpdateAffiliateAdminDto,
} from '../dto/affiliate.dto'

import type { AffiliateEntity } from '../../domain/entities/affiliate.entity'

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/affiliate')
export class AffiliateAdminController {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_COMMISSION_REPOSITORY)
    private readonly commissions: AffiliateCommissionRepository,
    @Inject(AFFILIATE_ATTRIBUTION_REPOSITORY)
    private readonly attributions: AffiliateAttributionRepository,
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
    @Inject(AffiliateDailyRunUseCase) private readonly dailyRun: AffiliateDailyRunUseCase,
    @Inject(ClawbackPlayerCommissionsUseCase)
    private readonly clawback: ClawbackPlayerCommissionsUseCase,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * Список партнёров. admin-роли достаточно.
   */
  @Get('partners')
  @Roles('admin', 'superadmin')
  @UsePipes(new ZodValidationPipe(AffiliateListQuerySchema))
  async listPartners(query: AffiliateListQueryDto): Promise<{
    data: Array<{
      id: string
      email: string
      status: string
      tracking_code: string
      revshare_rate: string
      total_earned: string
      created_at: string
    }>
    meta: { page: number; perPage: number; total: number }
  }> {
    const page = await this.affiliates.list({
      status: query.status,
      search: query.search,
      page: query.page,
      perPage: query.per_page,
    })
    return {
      data: page.items.map((item) => ({
        id: item.id,
        email: item.email,
        status: item.status,
        tracking_code: item.trackingCode,
        revshare_rate: item.revshareRate,
        total_earned: item.totalEarned,
        created_at: item.createdAt.toISOString(),
      })),
      meta: { page: query.page, perPage: query.per_page, total: page.total },
    }
  }

  @Get('partners/:id')
  @Roles('admin', 'superadmin')
  async getPartner(@Param('id') id: string): Promise<{
    id: string
    email: string
    display_name: string | null
    status: string
    tracking_code: string
    revshare_rate: string
    revshare_percent: string
    total_earned: string
    total_paid: string
    suspended_reason: string | null
    is_agreed: boolean
    terms_version: string
    created_at: string
  }> {
    const affiliate = await this.requireAffiliate(id)
    // Версия условий берётся из настроек программы: конкретную версию, под
    // которой партнёр принял соглашение, мы не храним (agreedAt хранит только
    // дату). Для регуляторного аудита важно, что согласие есть и когда.
    const settings = await this.settings.get()
    return {
      id: affiliate.id,
      email: affiliate.email,
      display_name: affiliate.displayName,
      status: affiliate.status,
      tracking_code: affiliate.trackingCode,
      revshare_rate: affiliate.revshareRate,
      revshare_percent: revShareRateToPercent(affiliate.revshareRate),
      total_earned: affiliate.totalEarned,
      total_paid: affiliate.totalPaid,
      suspended_reason: affiliate.suspendedReason,
      is_agreed: affiliate.isAgreed,
      terms_version: settings.termsVersion,
      created_at: affiliate.createdAt.toISOString(),
    }
  }

  /**
   * Создание партнёра вручную (UC-AFF-17) — для оффлайн-партнёров,
   * пришедших по договору, без самостоятельной регистрации.
   */
  @Post('partners')
  @Roles('admin', 'superadmin')
  @UsePipes(new ZodValidationPipe(CreateAffiliateAdminSchema))
  async createPartner(
    @Body() body: CreateAffiliateAdminDto,
    @CurrentUser() admin: AdminActor,
    @Req() request: Request,
  ): Promise<{ id: string; tracking_code: string; revshare_rate: string }> {
    const created = await this.affiliates.create({
      userId: admin.id,
      email: body.email,
      passwordHash: '',
      trackingCode: await this.affiliates.generateUniqueTrackingCode(),
      revshareRate:
        body.revshare_rate !== undefined
          ? parseRevShareRate(body.revshare_rate)
          : parseRevShareRate((await this.settings.get()).defaultRevshareRate),
      payoutCurrency: body.payout_currency,
      displayName: body.display_name ?? null,
      country: body.country ?? null,
      isAgreed: true,
    })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'affiliate.partner.created',
      targetType: 'affiliate',
      targetId: created.id,
      payload: { email: created.email, revshareRate: created.revshareRate },
      ipAddress: request.ip,
    })
    return {
      id: created.id,
      tracking_code: created.trackingCode,
      revshare_rate: created.revshareRate,
    }
  }

  /**
   * Изменение партнёра: индивидуальная ставка, статус, контакты (UC-AFF-18/19).
   *
   * ВАЖНО: изменение ставки НЕ применяется задним числом. Уже рассчитанные
   * начисления хранят снимок revshare_rate, новая ставка действует со
   * следующего периода. Иначе пришлось бы отзывать выданное (ТЗ ч.8 §11.2).
   */
  @Patch('partners/:id')
  @Roles('admin', 'superadmin')
  @UsePipes(new ZodValidationPipe(UpdateAffiliateAdminSchema))
  async updatePartner(
    @Param('id') id: string,
    @Body() body: UpdateAffiliateAdminDto,
    @CurrentUser() admin: AdminActor,
    @Req() request: Request,
  ): Promise<{ id: string; revshare_rate: string; status: string }> {
    const before = await this.requireAffiliate(id)
    const revshareRate =
      body.revshare_rate !== undefined ? parseRevShareRate(body.revshare_rate) : undefined
    // Явное сопоставление, а не {...body}: DTO в HTTP-контракте snake_case
    // (API_CONVENTIONS §1.2), а вход репозитория — camelCase. Раскрытие
    // привело бы к тому, что все поля молча игнорируются.
    const updated = await this.affiliates.update(id, {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(revshareRate !== undefined ? { revshareRate } : {}),
      ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
      ...(body.country !== undefined ? { country: body.country } : {}),
      ...(body.telegram !== undefined ? { telegram: body.telegram } : {}),
      ...(body.website !== undefined ? { website: body.website } : {}),
      ...(body.payout_currency !== undefined ? { payoutCurrency: body.payout_currency } : {}),
      ...(body.suspended_reason !== undefined ? { suspendedReason: body.suspended_reason } : {}),
      ...(body.is_agreed !== undefined ? { isAgreed: body.is_agreed } : {}),
    })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: revshareRate !== undefined ? 'affiliate.rate.changed' : 'affiliate.partner.updated',
      targetType: 'affiliate',
      targetId: id,
      payload: {
        from: { revshareRate: before.revshareRate, status: before.status },
        to: { revshareRate: updated.revshareRate, status: updated.status },
        reason: body.suspended_reason ?? null,
      },
      ipAddress: request.ip,
    })
    return { id: updated.id, revshare_rate: updated.revshareRate, status: updated.status }
  }

  /** Настройки программы: ставка по умолчанию, пороги, флаги (UC-AFF-21). */
  @Get('settings')
  @Roles('admin', 'superadmin')
  async getSettings(): Promise<{
    settings: Record<string, string>
    revshare_percent: string
    raw: Array<{ key: string; value: string; type: string; updated_at: string }>
  }> {
    const [settings, raw] = await Promise.all([this.settings.get(), this.settings.listRaw()])
    return {
      settings: {
        enabled: String(settings.isEnabled),
        default_revshare_rate: settings.defaultRevshareRate,
        cookie_days: String(settings.cookieDays),
        min_deposit_rub: String(settings.minDepositRub),
        require_kyc: String(settings.requireKyc),
        negative_carryover: String(settings.negativeCarryover),
        attribution_model: settings.attributionModel,
        click_retention_days: String(settings.clickRetentionDays),
        auto_suspend_threshold: String(settings.autoSuspendThreshold),
        terms_version: settings.termsVersion,
      },
      revshare_percent: revShareRateToPercent(settings.defaultRevshareRate),
      raw: raw.map((row) => ({
        key: row.key,
        value: row.value,
        type: row.type,
        updated_at: row.updatedAt.toISOString(),
      })),
    }
  }

  /**
   * Запись настроек программы — только superadmin (влияет на P&L).
   * Валидация значения происходит ДО записи в БД.
   */
  @Post('settings')
  @Roles('superadmin')
  @UsePipes(new ZodValidationPipe(UpdateAffiliateSettingSchema))
  async updateSettings(
    @Body() body: { key: string; value: string; type: 'string' | 'number' | 'boolean' | 'json' },
    @CurrentUser() admin: AdminActor,
    @Req() request: Request,
  ): Promise<{ key: string; value: string }> {
    await this.settings.set({
      key: body.key as Parameters<typeof this.settings.set>[0]['key'],
      value: body.value,
      type: body.type,
      updatedBy: admin.id,
    })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'affiliate.settings.updated',
      targetType: 'system_setting',
      targetId: body.key,
      payload: { value: body.value },
      ipAddress: request.ip,
    })
    return { key: body.key, value: body.value }
  }

  /** Сводка по программе: партнёры, клики, начисления, топ (UC-AFF-22). */
  @Get('overview')
  @Roles('admin', 'superadmin')
  async overview(): Promise<{
    partners: { total: number; active: number; suspended: number; rejected: number }
    revenue: { total_commission: string; total_ngr: string }
  }> {
    const [all, active, suspended, rejected, partnersPage] = await Promise.all([
      this.affiliates.list({ page: 1, perPage: 1 }),
      this.affiliates.list({ status: 'active', page: 1, perPage: 1 }),
      this.affiliates.list({ status: 'suspended', page: 1, perPage: 1 }),
      this.affiliates.list({ status: 'rejected', page: 1, perPage: 1 }),
      this.commissions.list({ page: 1, perPage: 100 }),
    ])

    let totalCommission = '0'
    let totalNgr = '0'
    for (const item of partnersPage.items) {
      totalCommission = new Decimal(totalCommission).plus(item.commissionAmount).toFixed(8)
      totalNgr = new Decimal(totalNgr).plus(item.ngrAmount).toFixed(8)
    }

    return {
      partners: {
        total: all.total,
        active: active.total,
        suspended: suspended.total,
        rejected: rejected.total,
      },
      revenue: { total_commission: totalCommission, total_ngr: totalNgr },
    }
  }

  /** Все начисления программы с фильтрами (UC-AFF-24). */
  @Get('commissions')
  @Roles('admin', 'superadmin')
  @UsePipes(new ZodValidationPipe(CommissionListQuerySchema))
  async listCommissions(query: CommissionListQueryDto): Promise<{
    data: Array<{
      id: string
      affiliate_id: string
      player_id: string
      period_start: string
      currency: string
      ngr_amount: string
      revshare_rate: string
      commission_amount: string
      status: string
    }>
    meta: { page: number; perPage: number; total: number }
  }> {
    const page = await this.commissions.list({
      status: query.status,
      from: query.from !== undefined ? new Date(query.from) : undefined,
      to: query.to !== undefined ? new Date(query.to) : undefined,
      page: query.page,
      perPage: query.per_page,
    })
    return {
      data: page.items.map((item) => ({
        id: item.id,
        affiliate_id: item.affiliateId,
        player_id: item.playerId,
        period_start: item.periodStart.toISOString().slice(0, 10),
        currency: item.currency,
        ngr_amount: item.ngrAmount,
        revshare_rate: item.revshareRate,
        commission_amount: item.commissionAmount,
        status: item.status,
      })),
      meta: { page: query.page, perPage: query.per_page, total: page.total },
    }
  }

  /** Атрибуции с фильтрами — ручной разбор спорных случаев. */
  @Get('attributions')
  @Roles('admin', 'superadmin')
  async listAttributions(
    @Query()
    query: {
      status?: 'pending' | 'qualified' | 'rejected'
      page?: string
      per_page?: string
    },
  ): Promise<{
    data: Array<{
      id: string
      affiliate_id: string
      player_id: string
      status: string
      total_deposit: string
      reject_reason: string | null
      is_self_referral: boolean
      created_at: string
    }>
    meta: { page: number; perPage: number; total: number }
  }> {
    const page = Number(query.page ?? '1') || 1
    const perPage = Number(query.per_page ?? '20') || 20
    const result = await this.attributions.list({
      status: query.status,
      page,
      perPage,
    })
    return {
      data: result.items.map((item) => ({
        id: item.id,
        affiliate_id: item.affiliateId,
        player_id: item.playerId,
        status: item.status,
        total_deposit: item.totalDeposit,
        reject_reason: item.rejectReason,
        is_self_referral: item.isSelfReferral,
        created_at: item.createdAt.toISOString(),
      })),
      meta: { page, perPage, total: result.total },
    }
  }

  /**
   * Ручной запуск суточного расчёта (UC-AFF-25) — только superadmin.
   * Идемпотентен: повторный запуск не создаст дублей начислений.
   */
  @Post('run-daily')
  @Roles('superadmin')
  @UsePipes(new ZodValidationPipe(RunDailySchema))
  async runDaily(
    @Body() body: { date?: string },
    @CurrentUser() admin: AdminActor,
    @Req() request: Request,
  ): Promise<{
    date: string
    processed: number
    created: number
    credited: number
    errors: string[]
  }> {
    const result = await this.dailyRun.execute(body.date)
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'affiliate.daily.manual_run',
      targetType: 'affiliate_commission',
      targetId: result.date,
      payload: { date: result.date, created: result.created, credited: result.credited },
      ipAddress: request.ip,
    })
    return {
      date: result.date,
      processed: result.processed,
      created: result.created,
      credited: result.credited,
      errors: result.errors,
    }
  }

  /**
   * Ручной clawback по игроку (UC-AFF-26). Возвращает невозвратные суммы
   * наружу — админ обязан их увидеть, иначе долгpartner'у уйдёт в никуда.
   */
  @Post('clawback/:playerId')
  @Roles('superadmin')
  async runClawback(
    @Param('playerId') playerId: string,
    @CurrentUser() admin: AdminActor,
    @Req() request: Request,
  ): Promise<{
    cancelled: number
    reversed_amount: string
    insufficient_funds: Array<{ commission_id: string; amount: string; currency: string }>
  }> {
    const result = await this.clawback.execute({ playerId })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'affiliate.clawback.manual',
      targetType: 'user',
      targetId: playerId,
      payload: {
        cancelled: result.cancelled,
        reversedAmount: result.reversedAmount,
        unrecoverable: result.insufficientFunds.length,
      },
      ipAddress: request.ip,
    })
    return {
      cancelled: result.cancelled,
      reversed_amount: result.reversedAmount,
      insufficient_funds: result.insufficientFunds.map((item) => ({
        commission_id: item.commissionId,
        amount: item.amount,
        currency: item.currency,
      })),
    }
  }

  private async requireAffiliate(id: string): Promise<AffiliateEntity> {
    const affiliate = await this.affiliates.findById(id)
    if (affiliate === null) {
      throw new AffiliateNotFoundError(id)
    }
    return affiliate
  }
}
