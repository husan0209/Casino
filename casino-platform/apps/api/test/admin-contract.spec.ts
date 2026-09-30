/**
 * Аудит контрактов 2026-09-26: admin-эндпоинты не должны «мягко» возвращать
 * {success:false, error} с HTTP 200. Interceptor пропускает объекты с ключом
 * success как есть, клиент получал data:undefined — вход в админку «успешно
 * завершался» без токена, а создание админа без прав рапортовало об успехе.
 * Теперь бросаем HttpException — GlobalExceptionFilter отдаёт стандартный
 * error-конверт {success:false, error:{code, message}} с корректным статусом,
 * который errText() обоих фронтов уже умеет показывать.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  InvalidAdminCredentialsError,
  SuperadminOnlyError,
} from '../src/modules/admin/domain/errors'

vi.mock('@casino/database', () => ({
  prisma: { adminUser: { update: vi.fn().mockResolvedValue({}) } },
}))

import { AuditLogService } from '../src/modules/admin/application/audit-log.service'
import { AdminAdminsController } from '../src/modules/admin/presentation/controllers/admin-admins.controller'
import { AdminAuthController } from '../src/modules/admin/presentation/controllers/admin-auth.controller'

const auditRepo = { log: vi.fn().mockResolvedValue(undefined) }
const audit = new AuditLogService(
  auditRepo as unknown as ConstructorParameters<typeof AuditLogService>[0],
)

const adminOk = { id: 'a1', email: 'admin@casino.local', role: 'superadmin' }

const fakeAdminAuth = (validateResult: unknown) =>
  ({
    validate: vi.fn().mockResolvedValue(validateResult),
    sign: vi.fn().mockReturnValue('jwt-token'),
  }) as unknown as ConstructorParameters<typeof AdminAuthController>[0]

const reqWithRole = (role: string) =>
  ({ user: { id: 'a1', role }, ip: '127.0.0.1', headers: {} }) as unknown as Parameters<
    AdminAdminsController['create']
  >[1]

beforeEach(() => {
  auditRepo.log.mockClear()
})

describe('аудит 2026-09-26: POST /admin/auth/login', () => {
  it('неверные креды → InvalidAdminCredentialsError (401 + error-конверт), не HTTP-200', async () => {
    const ctl = new AdminAuthController(fakeAdminAuth(null), audit)
    await expect(ctl.login({ email: 'x@x.x', password: 'wrong-pass' })).rejects.toBeInstanceOf(
      InvalidAdminCredentialsError,
    )
  })

  it('верные креды → {accessToken, admin}', async () => {
    const auth = fakeAdminAuth(adminOk)
    const ctl = new AdminAuthController(auth, audit)
    const res = await ctl.login({ email: 'admin@casino.local', password: 'secret-pass' })
    expect(res).toEqual({ accessToken: 'jwt-token', admin: adminOk })
  })
})

describe('аудит 2026-09-26: POST /admin/admins (создание/деактивация)', () => {
  it('не-superadmin → SuperadminOnlyError (403), не «успех» с HTTP-200', async () => {
    const svc = { create: vi.fn(), block: vi.fn() } as unknown as ConstructorParameters<
      typeof AdminAdminsController
    >[0]
    const ctl = new AdminAdminsController(svc, audit)
    await expect(
      ctl.create({ email: 'x@x.x', password: 'secret-pass', role: 'admin' }, reqWithRole('admin')),
    ).rejects.toBeInstanceOf(SuperadminOnlyError)
    await expect(
      ctl.deactivate('a2', reqWithRole('admin')),
    ).rejects.toBeInstanceOf(SuperadminOnlyError)
    expect(svc.create).not.toHaveBeenCalled()
    expect(svc.block).not.toHaveBeenCalled()
  })

  it('superadmin → создание возвращает AdminUserRow, деактивация {ok:true}', async () => {
    const created = { id: 'a2', email: 'new@casino.local' }
    const svc = {
      create: vi.fn().mockResolvedValue(created),
      block: vi.fn().mockResolvedValue(created),
    } as unknown as ConstructorParameters<typeof AdminAdminsController>[0]
    const ctl = new AdminAdminsController(svc, audit)

    const res = await ctl.create({ email: 'new@casino.local' }, reqWithRole('superadmin'))
    expect(res).toEqual(created)
    expect(auditRepo.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.admin_created' }))

    await ctl.deactivate('a2', reqWithRole('superadmin'))
    expect(svc.block).toHaveBeenCalledWith('a2')
  })
})
