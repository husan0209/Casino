/**
 * Payment provider status mapping.
 *
 * DO NOT use string.includes/startsWith/endsWith on provider status.
 * It causes false positives: 'unpaid'.includes('paid'), 'prepaid', 'paid_late', etc.
 * Always use exact-match against the whitelist below.
 *
 * If a provider adds a new success status, add it to SUCCESS_STATUSES explicitly
 * and document in docs/tz-part-3-payments-wallet.md.
 */

const SUCCESS_STATUSES = new Set<string>([
  'paid',
  'success',
  'completed',
  'confirm',
  'succeeded',
  'captured',
  'done',
])

const FAILURE_STATUSES = new Set<string>([
  'failed',
  'failure',
  'canceled',
  'cancelled',
  'expired',
  'rejected',
  'declined',
  'error',
])

export type PaymentOutcome = 'success' | 'failure' | 'unknown'

/**
 * Maps a raw provider status string to a normalized outcome.
 * Case-insensitive: trims and lowercases before comparison.
 * Returns 'unknown' for statuses that don't match the whitelist.
 */
export function classifyPaymentStatus(rawStatus: string | null | undefined): PaymentOutcome {
  if (!rawStatus) {
    return 'unknown'
  }
  const normalized = String(rawStatus).trim().toLowerCase()
  if (SUCCESS_STATUSES.has(normalized)) {
    return 'success'
  }
  if (FAILURE_STATUSES.has(normalized)) {
    return 'failure'
  }
  return 'unknown'
}
