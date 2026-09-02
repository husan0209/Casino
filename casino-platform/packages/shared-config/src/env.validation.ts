import { z } from 'zod'

const UNSAFE_SECRET_PATTERNS = [
  'dev_',
  'dev',
  'your_',
  'your',
  'change_me',
  'changeme',
  'replace_me',
  'replaceme',
  'test_',
  'stub',
  'xxx',
  'xxxxxxxxxx',
]

const isUnsafeSecret = (value: string): boolean => {
  if (!value) return false
  const lower = value.toLowerCase()
  return UNSAFE_SECRET_PATTERNS.some(pattern => lower.includes(pattern))
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development','staging','production','test']).default('development'),
  APP_PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url(),
  ADMIN_URL: z.string().url(),
  DOMAIN: z.string().min(3),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(64),
  JWT_REFRESH_SECRET: z.string().min(64),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3002'),
  KYC_DEPOSIT_LIMIT_RUB: z.coerce.number().default(5000),
  REFERRAL_REWARD_RATE: z.coerce.number().default(0.05),
  INTERNAL_API_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  RUKASSA_API_BASE: z.string().url().optional(),
  RUKASSA_SHOP_ID: z.string().optional(),
  RUKASSA_API_KEY: z.string().optional(),
  RUKASSA_SECRET_KEY: z.string().optional(),
  NOWPAYMENTS_API_KEY: z.string().optional(),
  NOWPAYMENTS_API_BASE: z.string().url().optional(),
  GITSLOTPARK_AGENT_ID: z.string().optional(),
  GITSLOTPARK_API_TOKEN: z.string().optional(),
  GITSLOTPARK_SECRET_KEY: z.string().optional(),
  GITSLOTPARK_API_BASE: z.string().url().optional(),
  NOWPAYMENTS_IPN_SECRET: z.string().optional(),
  // GAP-33: scheduled jobs (BullMQ repeat) — интервалы в мс, не хардкод
  JOB_EXPIRE_DEPOSITS_EVERY_MS: z.coerce.number().int().positive().optional(),
  JOB_UPDATE_RATES_EVERY_MS: z.coerce.number().int().positive().optional(),
  JOB_WITHDRAWAL_REMINDER_EVERY_MS: z.coerce.number().int().positive().optional(),
  JOB_REFERRAL_DAILY_EVERY_MS: z.coerce.number().int().positive().optional(),
  DEMO_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().optional(),
  // ─── GAP-29: паритет с ENVIRONMENT_VARIABLES.md §22 (D3) ─────────────
  // Все — optional: код читает их напрямую из process.env с дефолтами;
  // валидация фиксирует тип/формат, не меняя поведение.
  THROTTLE_TTL_MS: z.coerce.number().int().positive().optional(),
  THROTTLE_GLOBAL_LIMIT: z.coerce.number().int().positive().optional(),
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().optional(),
  LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().optional(),
  LOCKOUT_WINDOW_MS: z.coerce.number().int().positive().optional(),
  LOCKOUT_DURATION_MS: z.coerce.number().int().positive().optional(),
  DB_POOL_SIZE: z.coerce.number().int().positive().optional(),
  DB_LOG_QUERIES: z.enum(['true', 'false']).optional(),
  REDIS_PASSWORD: z.string().optional(),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE_USER: z.string().optional(),
  JWT_AUDIENCE_ADMIN: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  TELEGRAM_BOT_NAME: z.string().optional(),
  RUKASSA_WEBHOOK_URL: z.string().url().optional(),
  RUKASSA_SUCCESS_URL: z.string().url().optional(),
  RUKASSA_FAIL_URL: z.string().url().optional(),
  NOWPAYMENTS_WEBHOOK_URL: z.string().url().optional(),
  SMTP_FROM_NAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  KYC_MIN_AGE: z.coerce.number().int().positive().optional(),
  KYC_DOCUMENT_MAX_SIZE_MB: z.coerce.number().int().positive().optional(),
  REFERRAL_ENABLED: z.enum(['true', 'false']).optional(),
  REFERRAL_MIN_WITHDRAWAL: z.coerce.number().optional(),
  UPLOAD_DIR: z.string().optional(),
  UPLOAD_MAX_SIZE_MB: z.coerce.number().int().positive().optional(),
  UPLOAD_ALLOWED_TYPES: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  NEXT_PUBLIC_API_URL: z.string().url().optional(),
  NEXT_PUBLIC_DOMAIN: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().optional(),
  NEXT_PUBLIC_TELEGRAM_BOT_NAME: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  LOG_DIR: z.string().optional(),
  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().optional(),
})
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      // Require payment provider secrets in production
      if (!env.RUKASSA_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RUKASSA_SECRET_KEY'],
          message: 'Required in production. Cannot start without Rukassa signature verification secret.',
        })
      }

      if (!env.NOWPAYMENTS_IPN_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['NOWPAYMENTS_IPN_SECRET'],
          message: 'Required in production. Cannot start without NOWPayments IPN verification secret.',
        })
      }

      // Demo provider must be disabled in production
      if (env.DEMO_PROVIDER_ENABLED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEMO_PROVIDER_ENABLED'],
          message: 'Demo provider must be disabled in production.',
        })
      }

      // Check for unsafe placeholder secrets
      if (env.JWT_ACCESS_SECRET && isUnsafeSecret(env.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET appears to be a placeholder. Use only real production secrets (openssl rand -hex 64).',
        })
      }

      if (env.JWT_REFRESH_SECRET && isUnsafeSecret(env.JWT_REFRESH_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET appears to be a placeholder. Use only real production secrets (openssl rand -hex 64).',
        })
      }

      if (env.RUKASSA_SECRET_KEY && isUnsafeSecret(env.RUKASSA_SECRET_KEY)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RUKASSA_SECRET_KEY'],
          message: 'Rukassa secret appears to be a placeholder. Use only real production secrets.',
        })
      }

      if (env.NOWPAYMENTS_IPN_SECRET && isUnsafeSecret(env.NOWPAYMENTS_IPN_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['NOWPAYMENTS_IPN_SECRET'],
          message: 'NOWPayments secret appears to be a placeholder. Use only real production secrets.',
        })
      }
    }
  })

export type Env = z.infer<typeof envSchema>

export function validateEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input)
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors
    console.error('❌ Invalid env:', details)
    // Детали в сообщении: иначе при старте прода в логе — головоломка без контекста
    throw new Error(`Invalid environment variables: ${JSON.stringify(details)}`)
  }
  return parsed.data
}
