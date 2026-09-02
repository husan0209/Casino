export const QUEUES = { EMAIL: 'email', MAINTENANCE: 'maintenance' } as const

/** Имена repeatable-job'ов maintenance-очереди (GAP-33, ТЗ ч.3 §13). */
export const MAINTENANCE_JOBS = [
  'expire-deposits',
  'update-rates',
  'withdrawal-reminder',
  'referral-daily',
] as const

export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[number]

export interface EmailJobData {
  to: string
  subject: string
  text: string
  html?: string | undefined
  /** id записи в notifications – воркер проставит sentAt после успешной отправки */
  notificationId?: string
}

/** 'queued' – ушло в BullMQ (sentAt проставит воркер); 'logged' – dev-режим без Redis. */
export type EnqueueResult = 'queued' | 'logged'

export interface EmailQueuePort {
  enqueue(job: EmailJobData): Promise<EnqueueResult>
}

export const EMAIL_QUEUE_PORT = Symbol('EMAIL_QUEUE_PORT')
export const MAILER_PORT = Symbol('MAILER_PORT')
