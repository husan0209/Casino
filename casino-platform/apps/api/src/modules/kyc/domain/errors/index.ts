import { AppError } from '@casino/shared-utils'
export class KycRequiredError extends AppError { readonly code='KYC_REQUIRED'; readonly httpStatus=422; constructor(msg='KYC verification required'){ super(msg) } }
export class KycAlreadySubmittedError extends AppError { readonly code='KYC_ALREADY_SUBMITTED'; readonly httpStatus=409; constructor(){ super('KYC already submitted') } }
