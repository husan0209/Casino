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
  if (!value) {
    return false
  }
  const lower = value.toLowerCase()
  return UNSAFE_SECRET_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Секреты, для которых в production запрещено placeholder-значение
 * (`dev_…`, `your_…`, `stub` и т.п. — UNSAFE_SECRET_PATTERNS).
 */
const PRODUCTION_SECRET_KEYS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'RUKASSA_SECRET_KEY',
  'NOWPAYMENTS_IPN_SECRET',
] as const

/** Обязательные в production переменные: ключ → сообщение об ошибке. */
const PRODUCTION_REQUIRED: ReadonlyArray<readonly [string, string]> = [
  [
    'RUKASSA_SECRET_KEY',
    'Required in production. Cannot start without Rukassa signature verification secret.',
  ],
  [
    'NOWPAYMENTS_IPN_SECRET',
    'Required in production. Cannot start without NOWPayments IPN verification secret.',
  ],
]

/**
 * Проверка placeholder-секретов по списку ключей.
 *
 * Вынесена из superRefine ради complexity (лимит 10): четыре одинаковых `if`
 * с `&&` давали 8 единиц сложности. Сообщение строится из ключа, поэтому
 * проверка на текст в тестах идёт по регулярке `appears to be a placeholder`.
 */
function addPlaceholderSecretIssues(env: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const key of PRODUCTION_SECRET_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && isUnsafeSecret(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} appears to be a placeholder. Use only real production secrets (openssl rand -hex 64).`,
      })
    }
  }
}

/** Проверка переменных, без которых в production старт невозможен. */
function addRequiredProductionIssues(env: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const [key, message] of PRODUCTION_REQUIRED) {
    if (!env[key]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message })
    }
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
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
    // Порог вывода без верификации (решение владельца 2026-10-07): суммарно
    // выведенного и замороженного на эту сумму хватает, чтобы игрок получил
    // деньги без KYC-профиля; выше — KycRequiredError. Отдельный ключ, а не
    // переиспользование KYC_DEPOSIT_LIMIT_RUB: у депозитного порога теперь
    // смысл «риск-признак в логи», у этого — «отказ», и одно число на два
    // разных решения связало бы их навсегда.
    KYC_WITHDRAW_LIMIT_RUB: z.coerce.number().min(0).default(5000),
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
    // pre-launch hardening A1: очистка мёртвых сессий (default 1ч)
    JOB_CLEANUP_SESSIONS_EVERY_MS: z.coerce.number().int().positive().optional(),
    DEMO_PROVIDER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_HOST: z.string().optional(),
    // GAP-50: DSN опционален — без него Sentry no-op (dev/CI)
    SENTRY_DSN: z.string().url().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    // GAP-40: единственное каноническое имя — SMTP_PASSWORD (см. .env.example,
    // ENVIRONMENT_VARIABLES.md §10, README). Дубликат SMTP_PASS удалён.
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM_EMAIL: z.string().optional(),
    // GAP-02 post-MVP: вынос email-консьюмера в отдельный процесс (apps/api/src/worker.ts,
    // сервис `worker` в docker-compose.prod.yml). Optional: дефолт 'true' в коде —
    // консьюмер в процессе API (dev); prod compose переопределяет на сервисах.
    EMAIL_WORKER_IN_PROCESS: z.enum(['true', 'false']).optional(),
    // ─── GAP-29: паритет с ENVIRONMENT_VARIABLES.md §22 (D3) ─────────────
    // Все — optional: код читает их напрямую из process.env с дефолтами;
    // валидация фиксирует тип/формат, не меняя поведение.
    THROTTLE_TTL_MS: z.coerce.number().int().positive().optional(),
    THROTTLE_GLOBAL_LIMIT: z.coerce.number().int().positive().optional(),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().optional(),
    // pre-launch hardening B5: лимит попыток логина админки (default 5/окно)
    THROTTLE_ADMIN_LIMIT: z.coerce.number().int().positive().optional(),
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
    KYC_MIN_AGE: z.coerce.number().int().positive().optional(),
    KYC_DOCUMENT_MAX_SIZE_MB: z.coerce.number().int().positive().optional(),
    REFERRAL_ENABLED: z.enum(['true', 'false']).optional(),
    REFERRAL_MIN_WITHDRAWAL: z.coerce.number().optional(),
    // Партнёрская программа (ТЗ ч.8 §17). Дефолты — только для первого запуска:
    // после создания записи в system_settings значение берётся из БД, и админка
    // перекрывает env (иначе админ поменял ставку в UI, а cron считает по env).
    AFFILIATE_ENABLED: z.enum(['true', 'false']).optional(),
    AFFILIATE_JWT_SECRET: z.string().min(64).optional(),
    AFFILIATE_JWT_ACCESS_EXPIRES_IN: z.string().optional(),
    AFFILIATE_JWT_REFRESH_EXPIRES_IN: z.string().optional(),
    AFFILIATE_DEFAULT_REVSHARE_RATE: z.coerce.number().min(0).max(1).optional(),
    AFFILIATE_COOKIE_DAYS: z.coerce.number().int().positive().max(365).optional(),
    AFFILIATE_CLICK_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).optional(),
    JOB_AFFILIATE_DAILY_EVERY_MS: z.coerce.number().int().positive().optional(),
    JOB_AFFILIATE_QUALIFICATION_EVERY_MS: z.coerce.number().int().positive().optional(),
    JOB_AFFILIATE_CLICKS_CLEANUP_EVERY_MS: z.coerce.number().int().positive().optional(),
    // Rate limit партнёрского трекинга и auth-эндпоинтов программы.
    THROTTLE_AFFILIATE_TRACKING_LIMIT: z.coerce.number().int().positive().optional(),
    THROTTLE_AFFILIATE_REGISTER_LIMIT: z.coerce.number().int().positive().optional(),
    THROTTLE_AFFILIATE_LOGIN_LIMIT: z.coerce.number().int().positive().optional(),
    UPLOAD_DIR: z.string().optional(),
    UPLOAD_MAX_SIZE_MB: z.coerce.number().int().positive().optional(),
    UPLOAD_ALLOWED_TYPES: z.string().optional(),
    SEED_ADMIN_EMAIL: z.string().optional(),
    SEED_ADMIN_PASSWORD: z.string().optional(),
    NEXT_PUBLIC_API_URL: z.string().url().optional(),
    NEXT_PUBLIC_DOMAIN: z.string().optional(),
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().optional(),
    NEXT_PUBLIC_TELEGRAM_BOT_NAME: z.string().optional(),
    // id бота нужен фронту, чтобы построить ссылку на oauth.telegram.org/auth
    // без виджета; пусто ⇒ кнопка входа через Telegram выключена.
    NEXT_PUBLIC_TELEGRAM_BOT_ID: z.string().optional(),
    NEXT_PUBLIC_IMAGE_HOSTS: z.string().optional(),
    // GAP-55 (ж) §5.2: капча Turnstile. Оба ключа optional: без них механизм
    // выключен (вход не должен ломаться непронастроенным окружением).
    TURNSTILE_SECRET_KEY: z.string().optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
    CAPTCHA_AFTER_FAILED_ATTEMPTS: z.coerce.number().int().positive().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
    LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
    LOG_DIR: z.string().optional(),
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().optional(),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().optional(),
    // ─── GAP-29: паритет с ENVIRONMENT_VARIABLES.md §22 (D3) — остаток ──────
    // Прежний детектор D3 (grep '^  [A-Z]…') не видел ключи схемы: они на четырёх
    // пробелах, поэтому он объявлял невалидированными ВСЕ 99 переменных, хотя
    // секция GAP-29 выше уже покрывала 98 из них. Детектор исправлен, а эти
    // шесть — настоящий остаток: ADMIN_DOMAIN/DB_* живут на уровне compose/nginx
    // (API их не читает), THROTTLE_REFRESH_LIMIT и WALLET_LOCK_TIMEOUT_MS —
    // читаются кодом напрямую из process.env с дефолтами.
    ADMIN_DOMAIN: z.string().min(3).optional(),
    DB_NAME: z.string().optional(),
    DB_USER: z.string().optional(),
    DB_PASSWORD: z.string().optional(),
    THROTTLE_REFRESH_LIMIT: z.coerce.number().int().positive().optional(),
    WALLET_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return
    }

    addRequiredProductionIssues(env, ctx)

    // Demo provider must be disabled in production
    if (env.DEMO_PROVIDER_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEMO_PROVIDER_ENABLED'],
        message: 'Demo provider must be disabled in production.',
      })
    }

    // GAP-40: если в проде задан SMTP-хост с пользователем — пароль обязателен
    if (env.SMTP_HOST && env.SMTP_USER && !env.SMTP_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_PASSWORD'],
        message:
          'SMTP_PASSWORD is required in production when SMTP_HOST and SMTP_USER are set; without it nodemailer cannot authenticate and all transactional emails (verification, password reset, notifications) silently fail.',
      })
    }

    addPlaceholderSecretIssues(env, ctx)
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
