import { z } from 'zod'

export const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  APP_PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url(),
  ADMIN_URL: z.string().url(),
  DOMAIN: z.string().min(3),

  // Database
  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.coerce.number().default(10),
  DB_LOG_QUERIES: z.coerce.boolean().default(false),

  // Redis
  REDIS_URL: z.string().url(),
  REDIS_PASSWORD: z.string().min(1).optional(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(64),
  JWT_REFRESH_SECRET: z.string().min(64),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  JWT_ISSUER: z.string().default('casino-platform'),
  JWT_AUDIENCE_USER: z.string().default('user'),
  JWT_AUDIENCE_ADMIN: z.string().default('admin'),

  // OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_NAME: z.string().optional(),

  // Rukassa
  RUKASSA_SHOP_ID: z.string().optional(),
  RUKASSA_API_KEY: z.string().optional(),
  RUKASSA_SECRET_KEY: z.string().optional(),

  // NOWPayments
  NOWPAYMENTS_API_KEY: z.string().optional(),
  NOWPAYMENTS_IPN_SECRET: z.string().optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().email().optional(),

  // KYC
  KYC_DEPOSIT_LIMIT_RUB: z.coerce.number().default(5000),

  // Referral
  REFERRAL_REWARD_RATE: z.coerce.number().default(0.05),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3002'),

  // Internal
  INTERNAL_API_SECRET: z.string().min(16).optional(),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input)
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid env:', parsed.error.flatten().fieldErrors)
    throw new Error('Invalid environment variables')
  }
  return parsed.data
}
