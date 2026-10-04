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

/**
 * Порт рассылки: у admin осталась только READ-часть — список адресатов.
 *
 * Запись в `notifications` делает владелец таблицы через `NotificationsFacade`
 * (гард G24): формат уведомления — channel, default `data`, правило `isRead` —
 * должен задавать один модуль, иначе рассинхрон молча расходится по коду.
 * Чтение списка пользователей легализовано ADR GAP-51 (read-only).
 */
export interface IAdminBroadcastRepository {
  getAllUserIds(): Promise<string[]>
}

export const ADMIN_BROADCAST_REPOSITORY = Symbol('ADMIN_BROADCAST_REPOSITORY')
