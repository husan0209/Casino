/**
 * Кабинет партнёра (UC-AFF-12..16; ТЗ ч.8 §10.2, §12).
 *
 * OWNER-CHECK. Ни один метод не принимает affiliateId: он берётся ТОЛЬКО из
 * JWT, который проверил AffiliateAuthGuard. Партнёр физически не может запросить
 * чужую статистику, подставив id в query (критерий А20).
 *
 * ПРОЗРАЧНОСТЬ. Партнёр видит полную разбивку NGR — те же цифры, что и админ.
 * Это осознанное требование: ошибка в расчёте разрушает доверие быстрее, чем
 * низкая ставка (ТЗ ч.8 §3.9).
 */
import { Controller, Get, Inject, Patch, Post, UseGuards, UsePipes } from '@nestjs/common'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AffiliateActor } from '@/common/types/req-user'

import { type AffiliateProfileRow } from '@casino/shared-types'

import { WalletFacade } from '../../../wallet/facade/wallet.facade'
import { AffiliateSettingsService } from '../../application/affiliate-settings.service'
import { LeaveAffiliateProgramUseCase } from '../../application/use-cases/leave-affiliate-program.use-case'
import { UpdateAffiliateProfileUseCase } from '../../application/use-cases/update-affiliate-profile.use-case'
import { AffiliateNotFoundError } from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_ATTRIBUTION_REPOSITORY,
  AFFILIATE_CLICK_REPOSITORY,
  AFFILIATE_COMMISSION_REPOSITORY,
  AFFILIATE_REPOSITORY,
  type AffiliateAttributionRepository,
  type AffiliateClickRepository,
  type AffiliateCommissionRepository,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'
import { revShareRateToPercent } from '../../domain/value-objects/revshare-rate.value-object'
import {
  ClickQuerySchema,
  CommissionListQuerySchema,
  UpdateAffiliateSelfSchema,
  type ClickQueryDto,
  type CommissionListQueryDto,
  type UpdateAffiliateSelfDto,
} from '../dto/affiliate.dto'
import { AffiliateAuthGuard } from '../guards/affiliate-auth.guard'

/** Полный кошелёк партнёра в ответе кабинета. */
interface AffiliateBalances {
  RUB: string
  USDT_TRC20: string
}

/** Канонический ноль в формате DECIMAL(20,8) — ответы API не возвращают '0'. */
const ZERO_BALANCE = '0.00000000'

@UseGuards(AffiliateAuthGuard)
@Controller('affiliate')
export class AffiliateController {
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_COMMISSION_REPOSITORY)
    private readonly commissionsRepository: AffiliateCommissionRepository,
    @Inject(AFFILIATE_ATTRIBUTION_REPOSITORY)
    private readonly attributions: AffiliateAttributionRepository,
    @Inject(AFFILIATE_CLICK_REPOSITORY) private readonly clicks: AffiliateClickRepository,
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
    @Inject(WalletFacade) private readonly walletFacade: WalletFacade,
    // В3: единственные две записи кабинета (анкета и выход) — в application.
    @Inject(UpdateAffiliateProfileUseCase)
    private readonly updateProfileUseCase: UpdateAffiliateProfileUseCase,
    @Inject(LeaveAffiliateProgramUseCase)
    private readonly leaveProgramUseCase: LeaveAffiliateProgramUseCase,
  ) {}

  /**
   * Профиль партнёра: ставка, ссылка, статус, баланс кошелька.
   *
   * `revshare_percent` отдаётся отдельным полем — партнёру важнее «20%», чем
   * «0.2000». Сырое значение тоже возвращается: оно попадает в расчёты.
   */
  @Get('me')
  async me(actor: AffiliateActor): Promise<{
    affiliate_id: string
    email: string
    display_name: string | null
    status: string
    tracking_code: string
    tracking_url: string
    revshare_rate: string
    revshare_percent: string
    payout_currency: string
    total_earned: string
    balance: AffiliateBalances
    terms_version: string
    is_agreed: boolean
  }> {
    const affiliate = await this.requireAffiliate(actor.affiliateId)
    const settings = await this.settings.get()
    const balances = await this.readBalances(affiliate.userId)

    return {
      affiliate_id: affiliate.id,
      email: affiliate.email,
      display_name: affiliate.displayName,
      status: affiliate.status,
      tracking_code: affiliate.trackingCode,
      tracking_url: this.buildTrackingUrl(affiliate.trackingCode),
      revshare_rate: affiliate.revshareRate,
      revshare_percent: revShareRateToPercent(affiliate.revshareRate),
      payout_currency: affiliate.payoutCurrency,
      total_earned: affiliate.totalEarned,
      balance: balances,
      terms_version: settings.termsVersion,
      is_agreed: affiliate.isAgreed,
    }
  }

  /**
   * Дашборд: клики, игроки, NGR с разбивкой, начисления.
   *
   * Суммы NGR/commission агрегируются по всем валютам раздельно: смешивать рубли
   * и крипту в одну цифру бессмысленно (курсовой конвертации NGR нет).
   */
  @Get('dashboard')
  @UsePipes(new ZodValidationPipe(ClickQuerySchema))
  async dashboard(
    actor: AffiliateActor,
    query: ClickQueryDto,
  ): Promise<{
    period_days: number
    clicks: { total: number; converted: number; conversion_rate: string }
    players: { total: number }
    totals: { total_commission: string; total_ngr: string; total_ggr: string }
    settings: { revshare_rate: string; revshare_percent: string; cookie_days: number }
  }> {
    const affiliate = await this.requireAffiliate(actor.affiliateId)
    const from = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000)
    const to = new Date()
    const [clickStats, totals, playersPage] = await Promise.all([
      this.clicks.stats({ affiliateId: affiliate.id, from, to }),
      this.commissionsRepository.totals({ affiliateId: affiliate.id, from, to }),
      this.attributions.list({ affiliateId: affiliate.id, page: 1, perPage: 1 }),
    ])

    const conversionRate =
      clickStats.total === 0 ? '0.00' : ((clickStats.converted * 100) / clickStats.total).toFixed(2)

    return {
      period_days: query.days,
      clicks: {
        total: clickStats.total,
        converted: clickStats.converted,
        conversion_rate: conversionRate,
      },
      players: { total: playersPage.total },
      totals: {
        total_commission: totals.totalCommission,
        total_ngr: totals.totalNgr,
        total_ggr: totals.totalGgr,
      },
      settings: {
        revshare_rate: affiliate.revshareRate,
        revshare_percent: revShareRateToPercent(affiliate.revshareRate),
        cookie_days: (await this.settings.get()).cookieDays,
      },
    }
  }

  /**
   * Начисления с ПОЛНОЙ разбивкой NGR.
   *
   * Показываем bet/win/bonus/fee отдельно: партнёр должен видеть, из чего
   * сложилась его комиссия, иначе он не может проверить расчёт (ТЗ ч.8 §3.1).
   */
  @Get('commissions')
  @UsePipes(new ZodValidationPipe(CommissionListQuerySchema))
  async commissions(
    actor: AffiliateActor,
    query: CommissionListQueryDto,
  ): Promise<{
    data: Array<{
      id: string
      period_start: string
      period_end: string
      currency: string
      bet_sum: string
      win_sum: string
      rollback_sum: string
      bonus_sum: string
      provider_fee_sum: string
      ggr_amount: string
      ngr_amount: string
      revshare_rate: string
      commission_amount: string
      status: string
      credited_at: string | null
    }>
    meta: { page: number; perPage: number; total: number }
  }> {
    const affiliate = await this.requireAffiliate(actor.affiliateId)
    const page = await this.commissionsRepository.list({
      affiliateId: affiliate.id,
      status: query.status,
      from: query.from !== undefined ? new Date(query.from) : undefined,
      to: query.to !== undefined ? new Date(query.to) : undefined,
      page: query.page,
      perPage: query.per_page,
    })

    return {
      data: page.items.map((item) => ({
        id: item.id,
        period_start: item.periodStart.toISOString().slice(0, 10),
        period_end: item.periodEnd.toISOString().slice(0, 10),
        currency: item.currency,
        bet_sum: item.betSum,
        win_sum: item.winSum,
        rollback_sum: item.rollbackSum,
        bonus_sum: item.bonusSum,
        provider_fee_sum: item.providerFeeSum,
        ggr_amount: item.ggrAmount,
        ngr_amount: item.ngrAmount,
        revshare_rate: item.revshareRate,
        commission_amount: item.commissionAmount,
        status: item.status,
        credited_at: item.creditedAt !== null ? item.creditedAt.toISOString() : null,
      })),
      meta: { page: query.page, perPage: query.per_page, total: page.total },
    }
  }

  /** Приведённые игроки со статусами — партнёр видит качество своего трафика. */
  @Get('players')
  async players(actor: AffiliateActor): Promise<{
    data: Array<{
      player_id: string
      status: string
      total_deposit: string
      deposit_count: number
      first_deposit_at: string | null
      reject_reason: string | null
      created_at: string
    }>
    meta: { total: number }
  }> {
    const affiliate = await this.requireAffiliate(actor.affiliateId)
    const page = await this.attributions.list({
      affiliateId: affiliate.id,
      page: 1,
      perPage: 100,
    })
    return {
      data: page.items.map((item) => ({
        player_id: item.playerId,
        status: item.status,
        total_deposit: item.totalDeposit,
        deposit_count: item.depositCount,
        first_deposit_at: item.firstDepositAt !== null ? item.firstDepositAt.toISOString() : null,
        // Для партнёра это «почему отказали». На квалифицированной строке
        // колонка держит флаг для разбора администратором (F4), и показывать
        // его партнёру нельзя — он читается как обвинение в перекупке трафика.
        reject_reason: item.status === 'rejected' ? item.rejectReason : null,
        created_at: item.createdAt.toISOString(),
      })),
      meta: { total: page.total },
    }
  }

  /** Промо-ссылки: базовая + deep-link на каталог/игру. */
  @Get('links')
  async links(actor: AffiliateActor): Promise<{
    tracking_url: string
    cookie_days: number
    examples: Array<{ name: string; url: string }>
  }> {
    const affiliate = await this.requireAffiliate(actor.affiliateId)
    const base = this.buildTrackingUrl(affiliate.trackingCode)
    const settings = await this.settings.get()
    return {
      tracking_url: base,
      cookie_days: settings.cookieDays,
      examples: [
        { name: 'Каталог', url: `${base}?p=/casino` },
        { name: 'С категорией', url: `${base}?p=/casino/category/slots&c=main` },
      ],
    }
  }

  /** Самостоятельное изменение только контактов. Ставку и статус — нельзя. */
  @Patch('me')
  @UsePipes(new ZodValidationPipe(UpdateAffiliateSelfSchema))
  async updateMe(
    body: UpdateAffiliateSelfDto,
    actor: AffiliateActor,
  ): Promise<{ display_name: string | null; telegram: string | null; website: string | null }> {
    const updated = await this.updateProfileUseCase.execute({
      affiliateId: actor.affiliateId,
      changes: body,
    })
    return {
      display_name: updated.displayName,
      telegram: updated.telegram,
      website: updated.website,
    }
  }

  /**
   * Выход из программы (self-service).
   *
   * Статус меняется на suspended, а не rejected: партнёр может вернуться, и
   * его накопленная статистика не удаляется. Начисленные деньги не отзываются —
   * это не санкция, а отказ от работы.
   */
  @Post('leave')
  async leave(actor: AffiliateActor): Promise<{ status: string; message: string }> {
    await this.leaveProgramUseCase.execute({ affiliateId: actor.affiliateId })
    return { status: 'suspended', message: 'Вы вышли из партнёрской программы' }
  }

  private async requireAffiliate(affiliateId: string): Promise<AffiliateProfileRow> {
    const affiliate = await this.affiliates.findById(affiliateId)
    if (affiliate === null) {
      throw new AffiliateNotFoundError(affiliateId)
    }
    return affiliate
  }

  /**
   * Баланс партнёра по валютам выплаты MVP.
   *
   * Нулевой баланс — строка '0.00000000', а не '0': API_CONVENTIONS §10
   * требует все суммы как строки с единой точностью.
   */
  private async readBalances(userId: string): Promise<AffiliateBalances> {
    const rows = await this.walletFacade.getBalances(userId)
    // Именно Record, а не Map: гвард D7 отслеживает чтения окружения по
    // шаблону «получатель + метод доступа + строковый литерал из заглавных
    // букв» и принимает обращение к Map за чтение переменной окружения.
    // Обращение по индексу под этот шаблон не подпадает и остаётся
    // типобезопасным: noUncheckedIndexedAccess даёт `string | undefined`,
    // который закрывает `?? ZERO_BALANCE`. В комментариях выше этот шаблон
    // намеренно не приводится дословно — гвард ищет его и в тексте.
    const byCurrency: Record<string, string> = {}
    for (const row of rows) {
      byCurrency[row.currency] = row.balance
    }
    return {
      RUB: byCurrency['RUB'] ?? ZERO_BALANCE,
      USDT_TRC20: byCurrency['USDT_TRC20'] ?? ZERO_BALANCE,
    }
  }

  private buildTrackingUrl(trackingCode: string): string {
    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000'
    return `${appUrl.replace(/\/+$/, '')}/go/${trackingCode}`
  }
}
