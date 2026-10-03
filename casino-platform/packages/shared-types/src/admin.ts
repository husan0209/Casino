/** Строка админ-пользователя (Prisma AdminUser) — read-модель admin-списка.
 *  В4: row-типы ответов API живут в shared-types, а не в домене модуля. */
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
