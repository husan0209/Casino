---
title: Environment Variables
description: Все env-переменные casino-platform: группы, дефолты, валидация
status: living document
last_updated: 2026-06-19
---

# Environment Variables

> **Назначение:** Единый источник правды для всех переменных окружения. `.env.example` должен соответствовать этому документу.

---

## 1. Соглашения

### 1.1. Именование

- **UPPER_SNAKE_CASE** для имён
- **Префикс по домену:** `DATABASE_*`, `JWT_*`, `RUKASSA_*`, `NOWPAYMENTS_*`
- **Чувствительные** секреты никогда не в репо

### 1.2. Дефолты

- Дефолты только для не-секретных переменных
- Все секреты **БЕЗ дефолтов** (required)
- Дефолты описаны в Zod-схеме валидации при старте

### 1.3. Валидация при старте

```typescript
// apps/api/src/config/env.validation.ts
import { z } from 'zod'

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  APP_PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url(),
  ADMIN_URL: z.string().url(),
  DOMAIN: z.string().min(3),
  
  // Database
  DATABASE_URL: z.string().url(),
  
  // Redis
  REDIS_URL: z.string().url(),
  REDIS_PASSWORD: z.string().min(20),
  
  // JWT
  JWT_ACCESS_SECRET: z.string().min(64),
  JWT_REFRESH_SECRET: z.string().min(64),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  
  // ... остальные
})

export function validateEnv() {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('❌ Invalid env:', parsed.error.flatten().fieldErrors)
    process.exit(1)
  }
  return parsed.data
}
```

---

## 2. Application

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `NODE_ENV` | enum | ✅ | — | `development`, `staging`, `production` |
| `APP_PORT` | int | ❌ | `3001` | Порт API |
| `APP_URL` | URL | ✅ | — | `https://casino.example.com` |
| `ADMIN_URL` | URL | ✅ | — | `https://admin.casino.example.com` |
| `DOMAIN` | string | ✅ | — | `casino.example.com` (без доменной зоны) |

---

## 3. Database

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `DATABASE_URL` | URL | ✅ | — | `postgresql://user:pass@host:5432/db` |
| `DB_POOL_SIZE` | int | ❌ | `10` | Prisma connection pool |
| `DB_LOG_QUERIES` | bool | ❌ | `false` | Логировать все SQL запросы (только dev) |
| `DB_MIGRATE_ON_START` | bool | ❌ | `false` | Auto-migrate при старте (НЕ для prod) |

**Генерация DATABASE_URL:**

```
postgresql://DB_USER:DB_PASSWORD@DB_HOST:DB_PORT/DB_NAME
                        ↓          ↓           ↓         ↓
                  casino_prod  STRONG_PWD   postgres 5432  casino_prod
```

---

## 4. Redis

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `REDIS_URL` | URL | ✅ | — | `redis://:password@host:6379` |
| `REDIS_PASSWORD` | string | ✅ (prod) | — | ≥ 20 символов |
| `REDIS_TLS` | bool | ❌ | `false` | Use TLS для Redis |

---

## 5. JWT

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `JWT_ACCESS_SECRET` | string | ✅ | — | ≥ 64 chars (256 bits) |
| `JWT_REFRESH_SECRET` | string | ✅ | — | ≥ 64 chars, **отличается** от access |
| `JWT_ACCESS_EXPIRES_IN` | string | ❌ | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | string | ❌ | `30d` | Refresh token TTL |
| `JWT_ISSUER` | string | ❌ | `casino-platform` | `iss` claim |
| `JWT_AUDIENCE_USER` | string | ❌ | `user` | `aud` для user JWT |
| `JWT_AUDIENCE_ADMIN` | string | ❌ | `admin` | `aud` для admin JWT |

**Генерация секретов:**

```bash
openssl rand -hex 64
```

---

## 6. Google OAuth

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | string | ✅ | — | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | string | ✅ | — | From Google Cloud Console |
| `GOOGLE_CALLBACK_URL` | URL | ✅ | — | `https://casino.example.com/api/v1/auth/google/callback` |

---

## 7. Telegram Login

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | string | ✅ | — | From @BotFather |
| `TELEGRAM_BOT_NAME` | string | ✅ | — | `@your_casino_bot` |

---

## 8. Rukassa (Fiat Payments)

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `RUKASSA_SHOP_ID` | string | ✅ | — | Shop ID |
| `RUKASSA_API_KEY` | string | ✅ | — | API key |
| `RUKASSA_SECRET_KEY` | string | ✅ | — | HMAC secret |
| `RUKASSA_API_URL` | URL | ❌ | `https://lk.rukassa.is/api/v1` | API base |
| `RUKASSA_WEBHOOK_URL` | URL | ✅ | — | Public URL для callback |
| `RUKASSA_SUCCESS_URL` | URL | ✅ | — | Redirect после успеха |
| `RUKASSA_FAIL_URL` | URL | ✅ | — | Redirect после неудачи |

**Webhook registration:**

Зарегистрировать `RUKASSA_WEBHOOK_URL` в личном кабинете Rukassa.

---

## 9. NOWPayments (Crypto Payments)

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `NOWPAYMENTS_API_KEY` | string | ✅ | — | API key |
| `NOWPAYMENTS_IPN_SECRET` | string | ✅ | — | HMAC secret для IPN |
| `NOWPAYMENTS_API_URL` | URL | ❌ | `https://api.nowpayments.io/v1` | API base |
| `NOWPAYMENTS_WEBHOOK_URL` | URL | ✅ | — | Public URL для IPN |

---

## 10. SMTP (Email)

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `SMTP_HOST` | string | ✅ | — | `smtp.resend.com` (рекомендуется Resend) |
| `SMTP_PORT` | int | ✅ | `587` | TLS port |
| `SMTP_USER` | string | ✅ | — | `resend` or `apikey` |
| `SMTP_PASSWORD` | string | ✅ | — | API key от Resend |
| `SMTP_FROM_EMAIL` | email | ✅ | — | `noreply@casino.example.com` |
| `SMTP_FROM_NAME` | string | ❌ | `Casino Support` | Display name |

**Провайдеры:**

- **Resend** — рекомендуется для production (простой, хороший deliverability)
- **SendGrid** — альтернатива
- **Mailgun** — для EU compliance

---

## 11. KYC

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `KYC_DEPOSIT_LIMIT_RUB` | money | ❌ | `5000.00` | Суммарный лимит депозитов без KYC |
| `KYC_MIN_AGE` | int | ❌ | `18` | Минимальный возраст пользователя |
| `KYC_DOCUMENT_MAX_SIZE_MB` | int | ❌ | `10` | Макс размер документа |

---

## 12. Referral System

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `REFERRAL_REWARD_RATE` | decimal | ❌ | `0.05` | Доля реферера (5%) |
| `REFERRAL_ENABLED` | bool | ❌ | `true` | Включить ли программу |
| `REFERRAL_MIN_WITHDRAWAL` | money | ❌ | `100.00` | Минимум для вывода reward |

---

## 13. File Uploads

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `UPLOAD_DIR` | path | ✅ | `/app/uploads` | Директория для KYC/support файлов |
| `UPLOAD_MAX_SIZE_MB` | int | ❌ | `10` | Макс размер файла |
| `UPLOAD_ALLOWED_TYPES` | csv | ❌ | `jpg,jpeg,png,pdf,webp` | Extensions |

---

## 14. Rate Limiting

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `RATE_LIMIT_TTL_SECONDS` | int | ❌ | `60` | Период rate limit |
| `RATE_LIMIT_MAX_REQUESTS` | int | ❌ | `60` | Макс запросов в период |
| `RATE_LIMIT_AUTH_MAX` | int | ❌ | `10` | Auth-specific (login, register) |

---

## 15. Logging

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `LOG_LEVEL` | enum | ❌ | `info` | `error`, `warn`, `info`, `debug` |
| `LOG_FORMAT` | enum | ❌ | `json` | `json` или `pretty` (для dev) |
| `LOG_DIR` | path | ❌ | `/app/logs` | Куда писать логи |

---

## 16. Seeding (One-time)

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `SEED_ADMIN_EMAIL` | email | ❌ (one-time) | `superadmin@casino.example.com` | |
| `SEED_ADMIN_PASSWORD` | string | ❌ (one-time) | — | ≥ 12 chars |

⚠️ **Удалить** `SEED_*` после первой инициализации.

---

## 17. Internal Auth

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `INTERNAL_API_SECRET` | string | ✅ | — | Секрет для inter-service auth |

Используется для:
- Provider callbacks (вместо JWT)
- Admin задач по расписанию (BullMQ jobs)
- Внутренние health checks

---

## 18. Frontend (Next.js)

Frontend env доступны после `NEXT_PUBLIC_` prefix. Все остальные — только backend.

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | URL | ✅ | — | `https://casino.example.com/api/v1` |
| `NEXT_PUBLIC_DOMAIN` | string | ✅ | — | `casino.example.com` (для cookies) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | string | ✅ | — | Google OAuth |
| `NEXT_PUBLIC_TELEGRAM_BOT_NAME` | string | ✅ | — | Telegram widget |

---

## 19. CORS Origins

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `CORS_ORIGINS` | csv | ✅ | — | `https://casino.example.com,https://admin.casino.example.com` |

---

## 20. Чеклист при деплое

При каждом новом деплое:

- [ ] Все `REQUIRED` переменные установлены
- [ ] `JWT_*_SECRET` ≥ 64 символов
- [ ] `RUKASSA_*` / `NOWPAYMENTS_*` секреты не дефолтные
- [ ] `SMTP_*` credentials протестированы
- [ ] `.env.production` НЕ в git
- [ ] CORS origins только свои домены
- [ ] APP_URL совпадает с реальным доменом (иначе OAuth redirect fail)

---

## 21. Полный `.env.example`

```bash
# ── Application ────────────────────────────────────────────
NODE_ENV=development
APP_PORT=3001
APP_URL=http://localhost:3000
ADMIN_URL=http://localhost:3002
DOMAIN=localhost

# ── Database ───────────────────────────────────────────────
DATABASE_URL=postgresql://casino:casino_dev_password@localhost:5432/casino_dev
DB_POOL_SIZE=10
DB_LOG_QUERIES=false
DB_MIGRATE_ON_START=true

# ── Redis ──────────────────────────────────────────────────
REDIS_URL=redis://:casino_dev_password@localhost:6379
REDIS_PASSWORD=casino_dev_password

# ── JWT ────────────────────────────────────────────────────
JWT_ACCESS_SECRET=replace_with_64_chars_random_for_development_use_only
JWT_REFRESH_SECRET=replace_with_another_64_chars_random_for_development_use_only
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# ── Google OAuth ───────────────────────────────────────────
GOOGLE_CLIENT_ID=your_dev_client_id
GOOGLE_CLIENT_SECRET=your_dev_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3001/api/v1/auth/google/callback

# ── Telegram ───────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=your_dev_bot_token
TELEGRAM_BOT_NAME=your_dev_bot

# ── Rukassa ────────────────────────────────────────────────
RUKASSA_SHOP_ID=dev_shop_id
RUKASSA_API_KEY=dev_api_key
RUKASSA_SECRET_KEY=dev_secret_key
RUKASSA_API_URL=https://lk.rukassa.is/api/v1
RUKASSA_WEBHOOK_URL=http://localhost:3001/api/v1/payments/webhooks/rukassa
RUKASSA_SUCCESS_URL=http://localhost:3000/wallet?deposit=success
RUKASSA_FAIL_URL=http://localhost:3000/wallet?deposit=failed

# ── NOWPayments ────────────────────────────────────────────
NOWPAYMENTS_API_KEY=dev_nowpayments_key
NOWPAYMENTS_IPN_SECRET=dev_ipn_secret
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
NOWPAYMENTS_WEBHOOK_URL=http://localhost:3001/api/v1/payments/webhooks/nowpayments

# ── SMTP ───────────────────────────────────────────────────
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=re_xxxxxxxxxxxxx
SMTP_FROM_EMAIL=noreply@casino.example.com
SMTP_FROM_NAME=Casino Support

# ── KYC ────────────────────────────────────────────────────
KYC_DEPOSIT_LIMIT_RUB=5000
KYC_MIN_AGE=18
KYC_DOCUMENT_MAX_SIZE_MB=10

# ── Referral ───────────────────────────────────────────────
REFERRAL_REWARD_RATE=0.05
REFERRAL_ENABLED=true
REFERRAL_MIN_WITHDRAWAL=100

# ── Upload ─────────────────────────────────────────────────
UPLOAD_DIR=/app/uploads
UPLOAD_MAX_SIZE_MB=10
UPLOAD_ALLOWED_TYPES=jpg,jpeg,png,pdf,webp

# ── Rate Limiting ──────────────────────────────────────────
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=60
RATE_LIMIT_AUTH_MAX=10

# ── Logging ────────────────────────────────────────────────
LOG_LEVEL=info
LOG_FORMAT=pretty
LOG_DIR=/app/logs

# ── Seeding ────────────────────────────────────────────────
SEED_ADMIN_EMAIL=superadmin@casino.example.com
SEED_ADMIN_PASSWORD=dev_superadmin_password_123

# ── Internal Auth ──────────────────────────────────────────
INTERNAL_API_SECRET=replace_with_random_for_development

# ── Frontend ───────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_DOMAIN=localhost
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_dev_client_id
NEXT_PUBLIC_TELEGRAM_BOT_NAME=your_dev_bot

# ── CORS ───────────────────────────────────────────────────
CORS_ORIGINS=http://localhost:3000,http://localhost:3002
```
