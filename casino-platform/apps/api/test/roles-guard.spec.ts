/**
 * Юнит-тесты RolesGuard (найдено при GAP-32): guard читал метаданные только с
 * хендлера — class-level @Roles('admin','superadmin') на admin-контроллерах
 * игнорировался, и любой авторизованный user проходил. Фикс: getAllAndOverride
 * по [handler, class] — class-level применяется ко всем методам, method-level
 * (@Roles('superadmin') на run-daily) переопределяет.
 */
import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { RolesGuard, Roles } from '../src/modules/auth/presentation/guards/roles.guard'

@Roles('admin', 'superadmin')
class ClassOnly {
  handler() {}
}

class MethodOverrides {
  @Roles('superadmin')
  handler() {}
}

class NoRoles {
  handler() {}
}

function guardContext(user: { role: string } | undefined, handler: Function, target: object) {
  const guard = new RolesGuard(new Reflector())
  return guard.canActivate({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => target,
  } as never)
}

describe('RolesGuard (class-level metadata fix, GAP-32)', () => {
  it('class-level @Roles применяется ко всем методам класса (раньше игнорировался)', () => {
    const { handler } = ClassOnly.prototype
    expect(guardContext({ role: 'admin' }, handler, ClassOnly)).toBe(true)
    expect(guardContext({ role: 'superadmin' }, handler, ClassOnly)).toBe(true)
    expect(() => guardContext({ role: 'user' }, handler, ClassOnly)).toThrow(ForbiddenException)
  })

  it('method-level @Roles переопределяет class-level (run-daily только superadmin)', () => {
    const { handler } = MethodOverrides.prototype
    expect(guardContext({ role: 'superadmin' }, handler, MethodOverrides)).toBe(true)
    expect(() => guardContext({ role: 'admin' }, handler, MethodOverrides)).toThrow(ForbiddenException)
    expect(() => guardContext({ role: 'user' }, handler, MethodOverrides)).toThrow(ForbiddenException)
  })

  it('без метаданных guard пропускает (роли не заданы)', () => {
    const { handler } = NoRoles.prototype
    expect(guardContext({ role: 'user' }, handler, NoRoles)).toBe(true)
  })

  it('неавторизованный (нет user) — Forbidden при заданных ролях', () => {
    const { handler } = ClassOnly.prototype
    expect(() => guardContext(undefined, handler, ClassOnly)).toThrow(ForbiddenException)
  })
})
