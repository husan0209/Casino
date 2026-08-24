export const QUEUES = { EMAIL: 'email' } as const

export interface EmailJobData {
  to: string
  subject: string
  text: string
  html?: string
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
