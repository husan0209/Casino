/**
 * Юнит-тесты NotificationService — email-канал и отказ от рассылок.
 *
 * Регрессия (compliance, P1): проверка opt-out читалась как
 * `findUserSettings(...).catch(() => null)` и `settings?.notificationsEmail ?? true`.
 * Сбой чтения настроек тем самым трактовался как «разрешено», и письмо уходило
 * пользователю, который отписался. Отправка необратима, поэтому здесь
 * fail-closed: не прочитали настройки — письмо НЕ ставится в очередь, факт
 * остаётся в логе.
 *
 * Отказ (throw) и «строки настроек нет» — разные случаи второй части той же
 * проверки: отписаться можно только записав строку userSettings, значит у
 * пользователя без строки явного отказа нет и действует schema-default true.
 * Письма всем таким пользователям не отключаются — иначе фикс превратился бы
 * в молчаливый отказ от всей рассылки.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationService } from '../src/modules/notifications/application/notification.service'

import type { INotificationRepository } from '../src/modules/notifications/domain/notification.repository'
import type { EmailQueuePort } from '../src/queues/queue.types'

const USER_ID = 'user-1'
const NOTIFICATION_ID = 'notif-1'
const USER_EMAIL = 'player@example.test'

let create: ReturnType<typeof vi.fn>
let markSent: ReturnType<typeof vi.fn>
let findUserSettings: ReturnType<typeof vi.fn>
let findUserEmail: ReturnType<typeof vi.fn>
let enqueue: ReturnType<typeof vi.fn>
let service: NotificationService

beforeEach(() => {
  create = vi.fn().mockResolvedValue({ id: NOTIFICATION_ID, userId: USER_ID, channel: 'email' })
  markSent = vi.fn().mockResolvedValue(undefined)
  findUserSettings = vi.fn().mockResolvedValue({ notificationsEmail: true })
  findUserEmail = vi.fn().mockResolvedValue(USER_EMAIL)
  enqueue = vi.fn().mockResolvedValue('queued')
  const repo = { create, markSent, findUserSettings, findUserEmail }
  service = new NotificationService(
    { enqueue } as unknown as EmailQueuePort,
    repo as unknown as INotificationRepository,
  )
})

function sendEmailChannel() {
  return service.send({
    userId: USER_ID,
    type: 'INFO',
    channel: 'email',
    title: 'Начисление на счёт',
    message: 'Награда за реферала зачислена',
  })
}

describe('NotificationService.send — email-канал и opt-out (fail-closed)', () => {
  it('отказ чтения настроек: письмо НЕ уходит, ошибка не прячется в «разрешено»', async () => {
    // Arrange — прежний `.catch(() => null)` + `?? true` давали здесь enqueue
    findUserSettings.mockRejectedValue(new Error('user_settings unreadable'))
    // Act
    const notification = await sendEmailChannel()
    // Assert — irreversible-действие не выполняется по непрочитанным настройкам
    expect(enqueue).not.toHaveBeenCalled()
    expect(findUserEmail).not.toHaveBeenCalled()
    expect(notification).toMatchObject({ id: NOTIFICATION_ID })
  })

  it('отказ настроек не роняет отправку: запись уведомления сохранена', async () => {
    // Arrange — 5xx из-за сбоя настроек был бы хуже письма: воркер потерял бы событие
    findUserSettings.mockRejectedValue(new Error('connection lost'))
    // Act
    await expect(sendEmailChannel()).resolves.toMatchObject({ id: NOTIFICATION_ID })
    // Assert — internal-часть (строка notifications) не зависит от рассылки
    expect(create).toHaveBeenCalledTimes(1)
    expect(markSent).not.toHaveBeenCalled()
  })

  it('пользователь отписался (notificationsEmail=false) — в очередь не ставится', async () => {
    // Arrange
    findUserSettings.mockResolvedValue({ notificationsEmail: false })
    // Act
    await sendEmailChannel()
    // Assert
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('явное согласие — письмо в очереди с адресом, темой и notificationId', async () => {
    // Arrange
    findUserSettings.mockResolvedValue({ notificationsEmail: true })
    // Act
    await sendEmailChannel()
    // Assert — sentAt проставляет EmailWorker, здесь только становка в очередь
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: USER_EMAIL,
        subject: 'Начисление на счёт',
        text: 'Награда за реферала зачислена',
        notificationId: NOTIFICATION_ID,
      }),
    )
  })

  it('строки настроек нет — это НЕ сбой: явного отказа нет, письмо уходит', async () => {
    // Arrange — строка userSettings создаётся upsert-ом при смене настроек, её
    // отсутствие означает «пользователь ничего не отключал»
    findUserSettings.mockResolvedValue(null)
    // Act
    await sendEmailChannel()
    // Assert
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('внутренний канал: настройки рассылки не читаются, sentAt проставляется сразу', async () => {
    // Act
    await service.send({
      userId: USER_ID,
      type: 'INFO',
      channel: 'internal',
      title: 'Заголовок',
      message: 'Текст',
    })
    // Assert — opt-out касается только email
    expect(findUserSettings).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    expect(markSent).toHaveBeenCalledWith(NOTIFICATION_ID, expect.any(Date))
  })
})
