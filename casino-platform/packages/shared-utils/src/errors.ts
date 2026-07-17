export abstract class AppError extends Error { abstract readonly code: string; abstract readonly httpStatus: number; constructor(message: string, public readonly context?: Record<string, unknown>) { super(message); this.name = this.constructor.name } toJSON(){ return { code:this.code, message:this.message, context:this.context } } }
export class ValidationError extends AppError { readonly code='VALIDATION_ERROR'; readonly httpStatus=400 }
export class UnauthorizedError extends AppError { readonly code='UNAUTHORIZED'; readonly httpStatus=401 }
export class ForbiddenError extends AppError { readonly code='FORBIDDEN'; readonly httpStatus=403 }
export class NotFoundError extends AppError { readonly code='NOT_FOUND'; readonly httpStatus=404 }
export class ConflictError extends AppError { readonly code='CONFLICT'; readonly httpStatus=409 }
