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
  RUKASSA_SHOP_ID: z.string().optional(),
  RUKASSA_API_KEY: z.string().optional(),
  RUKASSA_SECRET_KEY: z.string().optional(),
  NOWPAYMENTS_API_KEY: z.string().optional(),
  NOWPAYMENTS_IPN_SECRET: z.string().optional(),
  DEMO_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
  SMTP_HOST: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().optional(),
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
    console.error('❌ Invalid env:', parsed.error.flatten().fieldErrors)
    throw new Error('Invalid environment variables')
  }
  return parsed.data
}
