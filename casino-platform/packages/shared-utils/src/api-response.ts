import type { ApiSuccessResponse, ApiErrorResponse, PaginationMeta } from '@casino/shared-types'
export function successResponse<T>(data: T, meta?: Record<string, unknown>): ApiSuccessResponse<T> { return { success: true, data, ...(meta && { meta }) } }
export function successPaginatedResponse<T>(data: T[], meta: PaginationMeta): ApiSuccessResponse<T[]> { return { success: true, data, meta } }
export function errorResponse(code: string, message: string, details?: Record<string, unknown>, requestId?: string): ApiErrorResponse { return { success: false, error: { code, message, details, requestId } } }
