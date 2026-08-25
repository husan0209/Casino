/**
 * Domain-тип провайдера аутентификации.
 * Зеркалит enum AuthProviderType в packages/database/prisma/schema.prisma.
 * Импорт генерируемого типа из @casino/database не используется, чтобы
 * domain-слой не зависел от сгенерированного клиента.
 */
export type AuthProviderKind = 'email' | 'google' | 'telegram'

export interface AuthProviderView {
  id: string
  userId: string
  provider: AuthProviderKind
  providerUserId: string | null
  providerEmail: string | null
}

export interface IAuthProviderRepository {
  findByProvider(provider: AuthProviderKind, providerUserId: string): Promise<AuthProviderView | null>
  create(input: { userId: string; provider: AuthProviderKind; providerUserId?: string | undefined; providerEmail?: string | undefined; providerData?: unknown }): Promise<AuthProviderView>
}

export const AUTH_PROVIDER_REPOSITORY = Symbol('AUTH_PROVIDER_REPOSITORY')
