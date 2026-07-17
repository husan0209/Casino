import { AppError } from '@casino/shared-utils'
export class GameNotFoundError extends AppError { readonly code='GAME_NOT_FOUND'; readonly httpStatus=404; constructor(slug:string){ super(`Game ${slug} not found`) } }
export class GameDisabledError extends AppError { readonly code='GAME_DISABLED'; readonly httpStatus=422; constructor(){ super('Game is disabled') } }
export class ProviderDisabledError extends AppError { readonly code='PROVIDER_MAINTENANCE'; readonly httpStatus=422; constructor(){ super('Provider is offline') } }
export class GameSessionInvalidError extends AppError { readonly code='GAME_SESSION_INVALID'; readonly httpStatus=422; constructor(){ super('Invalid or expired game session') } }
export class ProviderNotSupportedError extends AppError { readonly code='PROVIDER_NOT_SUPPORTED'; readonly httpStatus=501; constructor(slug:string){ super(`Provider ${slug} not supported`) } }
