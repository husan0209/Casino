export interface AuthProviderRecord {
  id: string
  userId: string
  provider: 'email' | 'google' | 'telegram'
  providerUserId: string | null
  providerEmail: string | null
  providerData: any
  createdAt: Date
}
export interface IAuthProviderRepository {
  findByProvider(provider: 'google'|'telegram', providerUserId: string): Promise<AuthProviderRecord | null>
  create(data: Omit<AuthProviderRecord,'id'|'createdAt'>): Promise<AuthProviderRecord>
}
export const AUTH_PROVIDER_REPOSITORY = Symbol('AUTH_PROVIDER_REPOSITORY')
