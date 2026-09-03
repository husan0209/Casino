/**
 * Репозитории admin-модуля: админ-пользователи, аудит, дашборд-агрегаты.
 * Application-слой не трогает Prisma напрямую (audit §A3/H5).
 * Дашборд читает чужие агрегаты (users/payments/kyc/tickets) — админ-модуль
 * по назначению кросс-доменный; TODO(GAP-22): рассмотреть Facade-порты.
 */
import { type Decimal } from 'decimal.js'


export interface AdminUserRow {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  role: string
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
}

export interface CreateAdminUserInput {
  email: string
  passwordHash: string
  role: string
  firstName?: string
  lastName?: string
  createdBy?: string
}

export interface IAdminUserRepository {
  list(page: number, perPage: number): Promise<{ items: AdminUserRow[]; total: number }>
  create(data: CreateAdminUserInput): Promise<AdminUserRow>
  setActive(id: string, isActive: boolean): Promise<AdminUserRow>
}

export const ADMIN_USER_REPOSITORY = Symbol('ADMIN_USER_REPOSITORY')

export interface AuditLogInput {
  actorType: 'user' | 'admin' | 'system'
  actorId: string
  action: string
  targetType?: string
  targetId?: string
  payload?: Record<string, unknown>
  /** express req.ip может быть undefined — exactOptionalPropertyTypes требует явного | undefined */
  ipAddress?: string | undefined
  userAgent?: string | undefined
}

export interface IAuditLogRepository {
  log(input: AuditLogInput): Promise<void>
}

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY')

export interface AdminFeedPayment {
  createdAt: Date
  type: string
  status: string
  amount: string | number | bigint | Decimal
  currency: string
  user: { email: string | null }
}
export interface AdminFeedKyc {
  submittedAt: Date | null
  status: string
  user: { email: string | null }
}
export interface AdminFeedBigWin {
  createdAt: Date
  amount: string | number | bigint | Decimal
  currency: string
  user: { email: string | null }
}
export interface AdminFeedSignup {
  createdAt: Date
  email: string | null
}
export interface AdminFeedTicket {
  createdAt: Date
  subject: string
  user: { email: string | null }
}
export interface PerDaySum {
  day: Date
  deposits: string
  withdrawals: string
}
export interface PerDayGgr {
  day: Date
  bets: string
  wins: string
}

export interface IDashboardRepository {
  countUsers(): Promise<number>
  countUsersCreatedSince(since: Date): Promise<number>
  findActiveUserIds(since: Date): Promise<string[]>
  /** Сумма завершённых платежей (в рублях) типа deposit/withdrawal за период или за всё время. */
  sumCompletedPaymentsRub(type: 'deposit' | 'withdrawal', since?: Date): Promise<string>
  /** Сумма игровых транзакций (bet/win) по валюте за период. */
  sumGameTransactions(type: 'bet' | 'win', currency: string, since: Date): Promise<string>
  countPendingWithdrawals(): Promise<number>
  countPendingKyc(): Promise<number>
  countOpenTickets(): Promise<number>
  registrationsPerDay(since: Date): Promise<Array<{ day: Date; count: number }>>
  paymentsPerDay(since: Date): Promise<PerDaySum[]>
  ggrPerDay(since: Date): Promise<PerDayGgr[]>
  recentPayments(limit: number): Promise<AdminFeedPayment[]>
  recentKyc(limit: number): Promise<AdminFeedKyc[]>
  recentBigWins(limit: number, minAmount: string): Promise<AdminFeedBigWin[]>
  recentSignups(limit: number): Promise<AdminFeedSignup[]>
  recentTickets(limit: number): Promise<AdminFeedTicket[]>
}

export const DASHBOARD_REPOSITORY = Symbol('DASHBOARD_REPOSITORY')
