import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import type {
  AuthProviderKind,
  AuthProviderView,
  IAuthProviderRepository,
} from '../../domain/repositories/auth-provider.repository'

@Injectable()
export class PrismaAuthProviderRepository implements IAuthProviderRepository {
  async findByProvider(
    provider: AuthProviderKind,
    providerUserId: string,
  ): Promise<AuthProviderView | null> {
    const row = await prisma.authProvider.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
    })
    if (!row) {
      return null
    }
    const view: AuthProviderView = {
      id: row.id,
      userId: row.userId,
      provider: row.provider as AuthProviderKind,
      providerUserId: row.providerUserId,
      providerEmail: row.providerEmail,
    }
    return view
  }

  async create(input: {
    userId: string
    provider: AuthProviderKind
    providerUserId?: string
    providerEmail?: string
    providerData?: unknown
  }): Promise<AuthProviderView> {
    const row = await prisma.authProvider.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId ?? null,
        providerEmail: input.providerEmail ?? null,
        providerData: (input.providerData ?? {}) as object,
      },
    })
    const view: AuthProviderView = {
      id: row.id,
      userId: row.userId,
      provider: row.provider as AuthProviderKind,
      providerUserId: row.providerUserId,
      providerEmail: row.providerEmail,
    }
    return view
  }
}
