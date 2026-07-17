import { z } from 'zod'
export const envSchema = z.object({
  NODE_ENV: z.enum(['development','staging','production']),
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
  NOWPAYMENTS_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().optional(),
})
export type Env = z.infer<typeof envSchema>
export function validateEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input)
  if (!parsed.success) { console.error('❌ Invalid env:', parsed.error.flatten().fieldErrors); throw new Error('Invalid environment variables') }
  return parsed.data
}
