import type { SystemSettingType } from '@prisma/client'

/** Волна 4 (В3): настройки/шаблоны и рассылка уведомлений — через порты
 *  вместо прямого prisma в контроллерах. */
export interface SystemSettingRow {
  id: string
  updatedAt: Date
  type: SystemSettingType
  description: string | null
  key: string
  value: string
  category: string | null
  updatedBy: string | null
}

export interface ISystemSettingRepository {
  findMany(): Promise<SystemSettingRow[]>
  findEmailTemplates(): Promise<SystemSettingRow[]>
  /**
   * Create-or-update по уникальному `key`.
   *
   * `category` — группировка в админ-UI; её задаёт владелец ключа (affiliate
   * пишет 'affiliate'). Без него create оставляет NULL — как до появления
   * этого поля. `type` применяется и на update: заявленный тип ключа обязан
   * совпадать с типом строки, иначе чтение из другой ветки молча получает
   * значение чужого типа.
   */
  upsert(input: {
    key: string
    value: string
    type: SystemSettingType
    updatedBy: string
    category?: string | undefined
  }): Promise<SystemSettingRow>
}

export const SYSTEM_SETTING_REPOSITORY = Symbol('SYSTEM_SETTING_REPOSITORY')

export interface NotificationBroadcastInput {
  userId: string
  title: string
  message: string
  type: string
  channel: 'internal'
  isRead: boolean
}

export interface IAdminBroadcastRepository {
  getAllUserIds(): Promise<string[]>
  createMany(notifications: NotificationBroadcastInput[]): Promise<void>
}

export const ADMIN_BROADCAST_REPOSITORY = Symbol('ADMIN_BROADCAST_REPOSITORY')
