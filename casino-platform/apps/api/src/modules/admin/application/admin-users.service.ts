import { Inject, Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import { UsersFacade } from '@modules/users/facade/users.facade'

import {
  ADMIN_USER_REPOSITORY,
  type AdminUserRow,
  type CreateAdminUserInput,
  type IAdminUserRepository,
} from '../domain/admin.repository'

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(ADMIN_USER_REPOSITORY) private readonly repo: IAdminUserRepository,
    @Inject(UsersFacade) private readonly users: UsersFacade,
  ) {}

  list(page = 1, perPage = 20): Promise<{ items: AdminUserRow[]; total: number }> {
    return this.repo.list(page, perPage)
  }

  async create(
    data: {
      email: string
      password: string
      first_name?: string
      last_name?: string
      role: 'admin' | 'superadmin'
    },
    createdBy?: string,
  ): Promise<AdminUserRow> {
    const passwordHash = await argon2.hash(data.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    })
    const createInput: CreateAdminUserInput = {
      email: data.email,
      passwordHash,
      role: data.role,
    }
    if (data.first_name !== undefined) {
      createInput.firstName = data.first_name
    }
    if (data.last_name !== undefined) {
      createInput.lastName = data.last_name
    }
    if (createdBy !== undefined) {
      createInput.createdBy = createdBy
    }
    return this.repo.create(createInput)
  }

  async block(id: string): Promise<AdminUserRow> {
    return this.repo.setActive(id, false)
  }

  async unblock(id: string): Promise<AdminUserRow> {
    return this.repo.setActive(id, true)
  }

  /**
   * Блокировка игрока — через `UsersFacade` (G24).
   *
   * Таблицы `users` и `sessions` админу не принадлежат, а правило «заблокирован
   * ⇒ живых сессий нет» принадлежит владельцу данных. Раньше этот метод звал
   * `repo.blockPlayer`, и admin-репозиторий писал в обе чужие таблицы.
   */
  blockPlayer(userId: string): Promise<void> {
    return this.users.blockPlayer(userId)
  }

  unblockPlayer(userId: string): Promise<void> {
    return this.users.unblockPlayer(userId)
  }

  touchLastLogin(id: string): Promise<void> {
    return this.repo.touchLastLogin(id)
  }
}
