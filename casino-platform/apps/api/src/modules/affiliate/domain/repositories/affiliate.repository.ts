/**
 * Порты репозиториев партнёрской программы (ТЗ ч.8 §6).
 *
 * Application-слой работает ТОЛЬКО через эти интерфейсы, реализации — в
 * infrastructure. Это даёт возможность тестировать use cases на mock-ах
 * без БД (MODULE_TEMPLATE шаг 10) и соблюдает правило «БД только в
 * infrastructure/repositories» (AI_DEVELOPMENT_RULES §3).
 *
 * DI-токены — Symbol, по образцу существующего REFERRAL_REPOSITORY.
 */
import type {
  AffiliateAttributionEntity,
  AffiliateAttributionStatus,
  AffiliateClickEntity,
  AffiliateCommissionEntity,
  AffiliateCommissionStatus,
  AffiliateEntity,
  AffiliateRejectReason,
  AffiliateStatus,
} from '../entities/affiliate.entity'
import type { RevShareRate } from '../value-objects/revshare-rate.value-object'

/** Ввод создания партнёра. */
export interface CreateAffiliateInput {
  userId: string
  email: string
  passwordHash: string
  trackingCode: string
  revshareRate: RevShareRate
  displayName?: string | null
  country?: string | null
  telegram?: string | null
  website?: string | null
  payoutCurrency: string
  isAgreed: boolean
}

/**
 * Поля, которые админ может изменить у партнёра.
 *
 * `| undefined` во всех опциональных полях — из-за exactOptionalPropertyTypes:
 * Zod-разбор body даёт `status: undefined` для отсутствующих ключей, и без
 * явного undefined такой объект не проходит типизацию.
 */
export interface UpdateAffiliateAdminInput {
  status?: AffiliateStatus | undefined
  revshareRate?: RevShareRate | undefined
  displayName?: string | null | undefined
  country?: string | null | undefined
  telegram?: string | null | undefined
  website?: string | null | undefined
  payoutCurrency?: string | undefined
  suspendedReason?: string | null | undefined
  isAgreed?: boolean | undefined
  trackingCode?: string | undefined
}

/** Поля, которые партнёр может изменить у себя. Ставку и статус — нельзя. */
export interface UpdateAffiliateSelfInput {
  displayName?: string | null | undefined
  telegram?: string | null | undefined
  website?: string | null | undefined
}

/** Ввод записи клика. ipHash уже посчитан (сырой IP наружу не выходит). */
export interface CreateClickInput {
  affiliateId: string
  landingPath: string
  ipHash: string
  userAgent?: string | null
  refererHost?: string | null
  geoCountry?: string | null
  campaignId?: string | null
  subId?: string | null
}

/** Суммы игровых операций игрока за период, сгруппированные по валютам. */
export interface GameSumRow {
  currency: string
  amount: string
}

/** Ввод создания атрибуции. */
export interface CreateAttributionInput {
  affiliateId: string
  playerId: string
  clickId?: string | null
  status: AffiliateAttributionStatus
  isSelfReferral?: boolean
  rejectReason?: AffiliateRejectReason | null
}

/** Ввод квалификации атрибуции. */
export interface QualifyAttributionInput {
  id: string
  firstDepositId: string | null
  firstDepositAt: Date | null
  totalDeposit: string
  depositCount: number
}

/** Данные для расчёта периода. */
export interface PeriodCommissionInput {
  affiliateId: string
  playerId: string
  attributionId?: string | null
  periodStart: Date
  periodEnd: Date
  currency: string
  betSum: string
  winSum: string
  rollbackSum: string
  bonusSum: string
  providerFeeSum: string
  ggrAmount: string
  ngrAmount: string
  revshareRate: RevShareRate
  commissionAmount: string
}

/** Агрегат начислений партнёра за период — для дашборда. */
export interface AffiliateCommissionTotals {
  totalCommission: string
  totalNgr: string
  totalGgr: string
  playersCount: number
  commissionsCount: number
}

/** Строка сводки: один игрок, участвующий в расчёте. */
export interface AttributionForCalc {
  attributionId: string
  affiliateId: string
  playerId: string
}

/** Последний значимый клик партнёра — источник антифрод-сигнатур (F1/F2). */
export interface LastClickSignals {
  ipHash: string | null
  userAgent: string | null
  clickId: string | null
  createdAt: Date | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Репозиторий партнёров
// ─────────────────────────────────────────────────────────────────────────────
export interface AffiliateRepository {
  findById(id: string): Promise<AffiliateEntity | null>
  findByEmail(email: string): Promise<AffiliateEntity | null>
  findByUserId(userId: string): Promise<AffiliateEntity | null>
  /** Основной lookup трекинга. Вызывается на каждом клике — обязан быть по индексу. */
  findByTrackingCode(code: string): Promise<AffiliateEntity | null>
  create(input: CreateAffiliateInput): Promise<AffiliateEntity>
  update(id: string, input: UpdateAffiliateAdminInput): Promise<AffiliateEntity>
  updateSelf(id: string, input: UpdateAffiliateSelfInput): Promise<AffiliateEntity>
  updatePasswordHash(id: string, passwordHash: string): Promise<void>
  touchLastLogin(id: string): Promise<void>
  touchLastClick(id: string, at: Date): Promise<void>
  /** Атомарная проверка уникальности кода: код занят ИЛИ свободен. */
  isTrackingCodeAvailable(code: string, excludeId?: string): Promise<boolean>
  /** Генерация уникального кода с retry по коллизиям. */
  generateUniqueTrackingCode(): Promise<string>
  /** Инкремент денормализованных итогов после успешного начисления. */
  addEarned(id: string, amount: string): Promise<void>
  list(args: {
    // `| undefined` обязателен: tsconfig включает exactOptionalPropertyTypes, а
    // Zod-парсинг query-параметров даёт поля вида `status: undefined` при их
    // отсутствии. Без явного undefined такой объект не assign'ится в тип.
    status?: AffiliateStatus | undefined
    search?: string | undefined
    page: number
    perPage: number
  }): Promise<{ items: AffiliateEntity[]; total: number }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Репозиторий кликов
// ─────────────────────────────────────────────────────────────────────────────
export interface AffiliateClickRepository {
  create(input: CreateClickInput): Promise<AffiliateClickEntity>
  markConverted(clickId: string): Promise<void>
  /** Сигнатуры последнего клика — вход антифрода F1/F2. */
  findLastByAffiliate(affiliateId: string): Promise<LastClickSignals | null>
  /** Сколько игроков с одного IP за окно у этого партнёра (правило F3). */
  countQualifiedByIpHash(args: {
    affiliateId: string
    ipHash: string
    since: Date
  }): Promise<number>
  stats(args: {
    affiliateId: string
    from: Date
    to: Date
  }): Promise<{ total: number; converted: number }>
  cleanupOlderThan(cutoff: Date): Promise<number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Репозиторий атрибуций
// ─────────────────────────────────────────────────────────────────────────────
export interface AffiliateAttributionRepository {
  findById(id: string): Promise<AffiliateAttributionEntity | null>
  findByPlayerId(playerId: string): Promise<AffiliateAttributionEntity | null>
  create(input: CreateAttributionInput): Promise<AffiliateAttributionEntity>
  qualify(input: QualifyAttributionInput): Promise<AffiliateAttributionEntity>
  reject(id: string, reason: AffiliateRejectReason): Promise<AffiliateAttributionEntity>
  /**
   * Начисление депозита квалифицированной атрибуции.
   * Возвращает false, если атрибуция ещё не qualified (депозит учтён, но
   * квалификация не пройдена) — тогда first_deposit_* остаётся пустым.
   */
  applyDeposit(args: {
    playerId: string
    paymentRequestId: string
    amount: string
    at: Date
  }): Promise<{ qualified: boolean; attributionId: string | null; isFirstDeposit: boolean }>
  /** Все квалифицированные атрибуции с депозитом — вход суточного расчёта. */
  listQualifiedForCalc(args: { until: Date; page: number; perPage: number }): Promise<{
    items: AttributionForCalc[]
    total: number
  }>
  /**
   * Активно ли самоисключение игрока (ответственная игра).
   *
   * Нужно для clawback-логики (решение C, ТЗ ч.8 §14.1): партнёр не должен
   * зарабатывать на игроке, который осознанно отказался от игры.
   *
   * ADR-обоснование: user_settings принадлежит модулю users, но это
   * read-only проверка одного булева флага для антифрод/ compliance-решения,
   * а не изменение данных users. Прямой доступ через общий Prisma-клиент
   * согласуется с уже принятым ADR GAP-51 для referrals.
   */
  isPlayerSelfExcluded(playerId: string): Promise<boolean>
  /** Пометить атрибуцию отменённой по compliance-причине. */
  cancelForCompliance(
    id: string,
    reason: AffiliateRejectReason,
  ): Promise<AffiliateAttributionEntity>
  list(args: {
    affiliateId?: string | undefined
    status?: AffiliateAttributionStatus | undefined
    page: number
    perPage: number
  }): Promise<{ items: AffiliateAttributionEntity[]; total: number }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Репозиторий начислений
// ─────────────────────────────────────────────────────────────────────────────
export interface AffiliateCommissionRepository {
  create(input: PeriodCommissionInput): Promise<AffiliateCommissionEntity>
  findById(id: string): Promise<AffiliateCommissionEntity | null>
  /** Ставит статус credited + ledger id ПОСЛЕ успешного WalletFacade.credit. */
  markCredited(id: string, ledgerEntryId: string, at: Date): Promise<void>
  markCancelled(id: string): Promise<AffiliateCommissionEntity>
  /** Идемпотентность расчёта. Возвращает существующее начисление, если оно уже было. */
  findByPeriod(args: {
    affiliateId: string
    playerId: string
    periodStart: Date
    currency: string
  }): Promise<AffiliateCommissionEntity | null>
  /**
   * Все ЗАЧИСЛЕННЫЕ (approved) начисления по игроку — вход clawback'а при
   * самоисключении (ТЗ ч.8 §14.1, решение варианта C).
   *
   * Возвращает и approved, и pending: pending ещё не начислены на кошелёк,
   * их достаточно пометить cancelled без денежной проводки.
   */
  listCreditableByPlayer(args: {
    playerId: string
    statuses: AffiliateCommissionStatus[]
  }): Promise<AffiliateCommissionEntity[]>
  totals(args: {
    affiliateId: string
    from?: Date | undefined
    to?: Date | undefined
  }): Promise<AffiliateCommissionTotals>
  list(args: {
    affiliateId?: string | undefined
    playerId?: string | undefined
    status?: AffiliateCommissionStatus | undefined
    from?: Date | undefined
    to?: Date | undefined
    page: number
    perPage: number
  }): Promise<{ items: AffiliateCommissionEntity[]; total: number }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Источники игровых сумм (ADR GAP-51 — read-only, тот же подход, что в referrals)
// ─────────────────────────────────────────────────────────────────────────────

/** Агрегаты игровых транзакций игрока за период. */
export interface GameTotalsByCurrency {
  bets: Map<string, string>
  wins: Map<string, string>
  rollbacks: Map<string, string>
}

export interface GameActivityRepository {
  /** Σ bet/win/rollback по игроку за период, сгруппированные по валютам. */
  sumGameActivity(args: { playerId: string; from: Date; to: Date }): Promise<GameTotalsByCurrency>
  /** Σ бонусов игрока за период по валютам (ledger_entries.type = 'BONUS'). */
  sumPlayerBonuses(args: { playerId: string; from: Date; to: Date }): Promise<Map<string, string>>
}

// ─────────────────────────────────────────────────────────────────────────────
// Отпечатки клиента (приватность + антифрод)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Хеширование IP и нормализация клиентских отпечатков (ТЗ ч.8 §6.2, §16).
 *
 * Порт живёт в domain, реализация — в infrastructure: use case'ам нужен сам
 * хеш и урезанные значения колонок, но знать про SHA-256, соль и длины
 * схемы им не положено. Главное — что реализация ОБЯЗАНА быть единственной:
 * если при записи клика и при проверке атрибуции хеш считается по-разному,
 * все антифрод-правила молча перестают работать. Поэтому порт инъецируется
 * в оба места.
 *
 * sanitizeUserAgent/extractRefererHost добавлены сюда же (В5): это та же
 * нормализация отпечатков клиента с теми же единственно верными границами.
 * Раньше track-click брал их как свободные функции напрямую из
 * infrastructure — то есть знание о длинах колонок протекало в
 * application-слой мимо контракта.
 */
export interface IpFingerprinter {
  /** SHA-256 от нормализованного IP с солью. Сырой IP наружу не отдаётся. */
  hash(ip: string): string
  /** User-Agent, урезанный до длины колонки; отсутствующий → null. */
  sanitizeUserAgent(userAgent: string | null | undefined): string | null
  /** ТОЛЬКО host из Referer: query с токенами в БД не уходит. Невалидный → null. */
  extractRefererHost(referer: string | null | undefined): string | null
}

export const AFFILIATE_IP_FINGERPRINTER = Symbol('AFFILIATE_IP_FINGERPRINTER')

// ─────────────────────────────────────────────────────────────────────────────
// DI-токены
// ─────────────────────────────────────────────────────────────────────────────
export const AFFILIATE_REPOSITORY = Symbol('AFFILIATE_REPOSITORY')
export const AFFILIATE_CLICK_REPOSITORY = Symbol('AFFILIATE_CLICK_REPOSITORY')
export const AFFILIATE_ATTRIBUTION_REPOSITORY = Symbol('AFFILIATE_ATTRIBUTION_REPOSITORY')
export const AFFILIATE_COMMISSION_REPOSITORY = Symbol('AFFILIATE_COMMISSION_REPOSITORY')
export const AFFILIATE_GAME_ACTIVITY_REPOSITORY = Symbol('AFFILIATE_GAME_ACTIVITY_REPOSITORY')

// ─────────────────────────────────────────────────────────────────────────────
// Порт внешних read-запросов, нужных use case'ам
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Данные игрока, нужные партнёрской программе.
 *
 * Отдельный порт, потому что `users` и `kyc` — чужие модули, а application-слой
 * affiliate не имеет права импортировать их репозитории или Prisma напрямую
 * (AI_DEVELOPMENT_RULES §3.2, правило no-restricted-imports в eslint).
 *
 * Нужен ДВУМ сценариям — оба ЧИТАЮЩИЕ:
 *  - генерация служебного referral_code партнёра (проверить свободен ли код);
 *  - квалификация атрибуции — проверить KYC (без него атрибуция не проходит).
 *
 * ⚠️ GAP-62 ЗАКРЫТ (2026-10-03): из порта вычеркнуты `createPlayerUser` и
 * `deletePlayerUser`. ADR GAP-51 разрешает affiliate только ЧТЕНИЕ чужих
 * таблиц (`users`, `kyc_profiles`) через общий Prisma-клиент; INSERT/DELETE в
 * `users` были незарегистрированным нарушением границ. Запись вернулась
 * владельцу — создание и компенсирующее удаление идут через `UsersFacade`
 * (`provisionAffiliatePlayer` / `deprovisionAffiliatePlayer`), то есть по
 * правилу MODULE_BOUNDARIES «межмодульное общение только через фасад».
 * Порт оставлен намеренно: чтения он по-прежнему инкапсулирует (Prisma не
 * должен протекать в application-слой), и именно поэтому он не «read-only
 * обёртка над фасадом» — users не владеет ни `kyc_profiles`, ни политикой
 * готовности KYC.
 */
export interface AffiliatePlayerProvisioningRepository {
  /** READ (легально по GAP-51). Свободен ли referral_code в users. */
  isPlayerReferralCodeAvailable(code: string): Promise<boolean>
  /** READ (легально по GAP-51). Пройдено ли KYC игрока (для квалификации атрибуции). */
  isKycApproved(playerId: string): Promise<boolean>
}

export const AFFILIATE_PLAYER_PROVISIONING_REPOSITORY = Symbol(
  'AFFILIATE_PLAYER_PROVISIONING_REPOSITORY',
)
