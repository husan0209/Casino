import { AppError } from '@casino/shared-utils'
export class KycRequiredError extends AppError { readonly code='KYC_REQUIRED'; readonly httpStatus=422; constructor(m='KYC verification required'){ super(m) } }
export class PaymentProviderError extends AppError { readonly code='PAYMENT_PROVIDER_ERROR'; readonly httpStatus=502; constructor(m='Payment provider error', ctx?:any){ super(m, ctx) } }
export class AmountTooSmallError extends AppError { readonly code='AMOUNT_TOO_SMALL'; readonly httpStatus=422; constructor(min:string){ super(`Amount too small, min ${min}`, { min }) } }
export class AmountTooLargeError extends AppError { readonly code='AMOUNT_TOO_LARGE'; readonly httpStatus=422; constructor(max:string){ super(`Amount too large, max ${max}`, { max }) } }
