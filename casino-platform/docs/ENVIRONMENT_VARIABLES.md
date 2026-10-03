---
title: Environment Variables
description: Все env-переменные casino-platform: группы, дефолты, валидация
status: living document
last_updated: 2026-08-28
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
// packages/shared-config/src/env.validation.ts
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

| Variable                                | Type   | Required     | Default          | Description                                                                                                                                                  |
| --------------------------------------- | ------ | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                              | enum   | ✅           | —                | `development`, `staging`, `production`                                                                                                                       |
| `APP_PORT`                              | int    | ❌           | `3001`           | Порт API                                                                                                                                                     |
| `APP_URL`                               | URL    | ✅           | —                | `https://casino.example.com`                                                                                                                                 |
| `ADMIN_URL`                             | URL    | ✅           | —                | `https://admin.casino.example.com`                                                                                                                           |
| `THROTTLE_TTL_MS`                       | int    | ❌           | `60000`          | Окно rate-limit в мс (GAP-19)                                                                                                                                |
| `THROTTLE_GLOBAL_LIMIT`                 | int    | ❌           | `120`            | Запросов/окно на IP (глобально)                                                                                                                              |
| `THROTTLE_AUTH_LIMIT`                   | int    | ❌           | `10`             | Запросов/окно на IP для `/auth/*`                                                                                                                            |
| `THROTTLE_REFRESH_LIMIT`                | int    | ❌           | `30`             | Запросов/окно на IP для `/auth/refresh` (зонд сессии при каждой загрузке страницы, P1 #11; в проде внешним ограничителем остаётся nginx `api_auth 10r/m`)    |
| `THROTTLE_ADMIN_LIMIT`                  | int    | ❌           | `5`              | Попыток логина админки за окно на IP (pre-launch B5)                                                                                                         |
| `LOCKOUT_MAX_ATTEMPTS`                  | int    | ❌           | `10`             | Неудачных входов за окно до блокировки аккаунта (GAP-18)                                                                                                     |
| `LOCKOUT_WINDOW_MS`                     | int    | ❌           | `900000`         | Скользящее окно подсчёта неудач, мс (15 мин)                                                                                                                 |
| `LOCKOUT_DURATION_MS`                   | int    | ❌           | `1800000`        | Длительность блокировки аккаунта, мс (30 мин)                                                                                                                |
| `JOB_EXPIRE_DEPOSITS_EVERY_MS`          | int    | ❌           | `300000`         | Интервал задачи истечения pending-депозитов, мс (GAP-33)                                                                                                     |
| `JOB_UPDATE_RATES_EVERY_MS`             | int    | ❌           | `300000`         | Интервал задачи обновления курсов, мс (GAP-33)                                                                                                               |
| `JOB_WITHDRAWAL_REMINDER_EVERY_MS`      | int    | ❌           | `3600000`        | Интервал напоминания о зависших выводах, мс (GAP-33)                                                                                                         |
| `JOB_REFERRAL_DAILY_EVERY_MS`           | int    | ❌           | `86400000`       | Интервал ежедневных реферальных начислений, мс (GAP-32/33)                                                                                                   |
| `JOB_CLEANUP_SESSIONS_EVERY_MS`         | int    | ❌           | `3600000`        | Интервал очистки мёртвых сессий (expired/отозванные >7 дней), мс — pre-launch hardening A1                                                                   |
| `JOB_AFFILIATE_DAILY_EVERY_MS`          | int    | ❌           | `86400000`       | Интервал суточного расчёта RevShare партнёрам (ТЗ ч.8 §15)                                                                                                   |
| `JOB_AFFILIATE_QUALIFICATION_EVERY_MS`  | int    | ❌           | `3600000`        | Интервал квалификации атрибуций (ловит гонку «депозит раньше KYC»)                                                                                           |
| `JOB_AFFILIATE_CLICKS_CLEANUP_EVERY_MS` | int    | ❌           | `86400000`       | Интервал retention кликов партнёрской программы                                                                                                              |
| `DOMAIN`                                | string | ✅           | —                | `casino.example.com` (без доменной зоны)                                                                                                                     |
| `ADMIN_DOMAIN`                          | string | ✅ (compose) | —                | Домен админки `admin.casino.example.com`. Читают compose (envsubst nginx-шаблона, сервис nginx) и `infra/scripts/ssl_init.sh`; код приложения — нет (GAP-56) |
| `SSL_EMAIL`                             | email  | ❌           | `admin@<DOMAIN>` | Email для выпуска Let's Encrypt в `infra/scripts/ssl_init.sh` (GAP-56)                                                                                       |

**Порты фронтендов в прод-compose.** Сервисы `web` и `admin` в
`docker-compose.prod.yml` получают `PORT` и `HOSTNAME` прямо в `environment:` — их нет
ни в `.env.example`, ни в `envSchema`, потому что их читает сгенерированный Next
`server.js`, а не код `apps/*`. Обязательны оба:

- `PORT` — standalone-сервер Next слушает `process.env.PORT` (дефолт **3000**), тогда
  как nginx-хост `ADMIN_DOMAIN` проксирует `http://admin:3002`. Без `PORT: "3002"`
  админка в проде не отвечала бы никогда; в dev это скрыто `next start -p 3002`.
- `HOSTNAME` — docker сам проставляет его в ID контейнера, и тогда сервер bind'ится на
  адрес eth0, из-за чего healthcheck'и compose на `127.0.0.1` не проходили бы.

---

## 3. Database

| Variable         | Type   | Required     | Default | Description                                                                                                                                                            |
| ---------------- | ------ | ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | URL    | ✅           | —       | `postgresql://user:pass@host:5432/db`                                                                                                                                  |
| `DB_USER`        | string | ✅ (compose) | —       | Пользователь БД. Читает `docker-compose.prod.yml` (контейнер postgres + интерполяция) и `infra/scripts/postgres-backup.sh`/`restore.sh`; код приложения — нет (GAP-56) |
| `DB_PASSWORD`    | string | ✅ (compose) | —       | Пароль БД; обязан совпадать с паролем в `DATABASE_URL`                                                                                                                 |
| `DB_NAME`        | string | ✅ (compose) | —       | Имя БД; обязано совпадать с путём в `DATABASE_URL`                                                                                                                     |
| `DB_POOL_SIZE`   | int    | ❌           | `10`    | Prisma connection pool                                                                                                                                                 |
| `DB_LOG_QUERIES` | bool   | ❌           | `false` | Логировать все SQL запросы (только dev)                                                                                                                                |

**Генерация DATABASE_URL:**

```
postgresql://DB_USER:DB_PASSWORD@DB_HOST:DB_PORT/DB_NAME
                        ↓          ↓           ↓         ↓
                  casino_prod  STRONG_PWD   postgres 5432  casino_prod
```

---

## 4. Redis

| Variable         | Type   | Required  | Default | Description                   |
| ---------------- | ------ | --------- | ------- | ----------------------------- |
| `REDIS_URL`      | URL    | ✅        | —       | `redis://:password@host:6379` |
| `REDIS_PASSWORD` | string | ✅ (prod) | —       | ≥ 20 символов                 |
| `REDIS_TLS`      | bool   | ❌        | `false` | Use TLS для Redis             |

---

## 5. JWT

| Variable                 | Type   | Required | Default           | Description                          |
| ------------------------ | ------ | -------- | ----------------- | ------------------------------------ |
| `JWT_ACCESS_SECRET`      | string | ✅       | —                 | ≥ 64 chars (256 bits)                |
| `JWT_REFRESH_SECRET`     | string | ✅       | —                 | ≥ 64 chars, **отличается** от access |
| `JWT_ACCESS_EXPIRES_IN`  | string | ❌       | `15m`             | Access token TTL                     |
| `JWT_REFRESH_EXPIRES_IN` | string | ❌       | `30d`             | Refresh token TTL                    |
| `JWT_ISSUER`             | string | ❌       | `casino-platform` | `iss` claim                          |
| `JWT_AUDIENCE_USER`      | string | ❌       | `user`            | `aud` для user JWT                   |
| `JWT_AUDIENCE_ADMIN`     | string | ❌       | `admin`           | `aud` для admin JWT                  |

**Генерация секретов:**

```bash
openssl rand -hex 64
```

---

## 6. Google OAuth

| Variable               | Type   | Required | Default | Description                                              |
| ---------------------- | ------ | -------- | ------- | -------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | string | ✅       | —       | From Google Cloud Console                                |
| `GOOGLE_CLIENT_SECRET` | string | ✅       | —       | From Google Cloud Console                                |
| `GOOGLE_CALLBACK_URL`  | URL    | ✅       | —       | `https://casino.example.com/api/v1/auth/google/callback` |

---

## 7. Telegram Login

| Variable             | Type   | Required | Default | Description        |
| -------------------- | ------ | -------- | ------- | ------------------ |
| `TELEGRAM_BOT_TOKEN` | string | ✅       | —       | From @BotFather    |
| `TELEGRAM_BOT_NAME`  | string | ✅       | —       | `@your_casino_bot` |

---

## 8. Rukassa (Fiat Payments)

| Variable              | Type   | Required | Default                  | Description                                |
| --------------------- | ------ | -------- | ------------------------ | ------------------------------------------ |
| `RUKASSA_SHOP_ID`     | string | ✅       | —                        | Shop ID                                    |
| `RUKASSA_API_KEY`     | string | ✅       | —                        | API key                                    |
| `RUKASSA_SECRET_KEY`  | string | ✅       | —                        | HMAC secret                                |
| `RUKASSA_API_BASE`    | URL    | ❌       | `https://pay.rukassa.is` | База API (клиент дописывает `/api/v1/...`) |
| `RUKASSA_WEBHOOK_URL` | URL    | ✅       | —                        | Public URL для callback                    |
| `RUKASSA_SUCCESS_URL` | URL    | ✅       | —                        | Redirect после успеха                      |
| `RUKASSA_FAIL_URL`    | URL    | ✅       | —                        | Redirect после неудачи                     |

**Webhook registration:**

Зарегистрировать `RUKASSA_WEBHOOK_URL` в личном кабинете Rukassa.

---

## 9. NOWPayments (Crypto Payments)

| Variable                  | Type   | Required | Default                         | Description         |
| ------------------------- | ------ | -------- | ------------------------------- | ------------------- |
| `NOWPAYMENTS_API_KEY`     | string | ✅       | —                               | API key             |
| `NOWPAYMENTS_IPN_SECRET`  | string | ✅       | —                               | HMAC secret для IPN |
| `NOWPAYMENTS_API_BASE`    | URL    | ❌       | `https://api.nowpayments.io/v1` | API base            |
| `NOWPAYMENTS_WEBHOOK_URL` | URL    | ✅       | —                               | Public URL для IPN  |

---

## 10. SMTP (Email)

| Variable                  | Type   | Required | Default          | Description                                                                                                                                                                                                                          |
| ------------------------- | ------ | -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SMTP_HOST`               | string | ✅       | —                | `smtp.resend.com` (рекомендуется Resend)                                                                                                                                                                                             |
| `SMTP_PORT`               | int    | ✅       | `587`            | TLS port                                                                                                                                                                                                                             |
| `SMTP_USER`               | string | ✅       | —                | `resend` or `apikey`                                                                                                                                                                                                                 |
| `SMTP_PASSWORD`           | string | ✅       | —                | API key от Resend                                                                                                                                                                                                                    |
| `SMTP_FROM_EMAIL`         | email  | ✅       | —                | `noreply@casino.example.com`                                                                                                                                                                                                         |
| `SMTP_FROM_NAME`          | string | ❌       | `Casino Support` | Display name                                                                                                                                                                                                                         |
| `EMAIL_WORKER_IN_PROCESS` | bool   | ❌       | `true`           | GAP-02 post-MVP: консьюмер BullMQ-очереди `email` в процессе API. `false` — очередь разбирает отдельный процесс `apps/api/src/worker.ts` (сервис `worker` в docker-compose.prod.yml); в compose флаг переопределён на обоих сервисах |

**Провайдеры:**

- **Resend** — рекомендуется для production (простой, хороший deliverability)
- **SendGrid** — альтернатива
- **Mailgun** — для EU compliance

---

## 11. KYC

| Variable                   | Type  | Required | Default   | Description                       |
| -------------------------- | ----- | -------- | --------- | --------------------------------- |
| `KYC_DEPOSIT_LIMIT_RUB`    | money | ❌       | `5000.00` | Суммарный лимит депозитов без KYC |
| `KYC_MIN_AGE`              | int   | ❌       | `18`      | Минимальный возраст пользователя  |
| `KYC_DOCUMENT_MAX_SIZE_MB` | int   | ❌       | `10`      | Макс размер документа             |

---

## 12. Referral System

| Variable                  | Type    | Required | Default  | Description               |
| ------------------------- | ------- | -------- | -------- | ------------------------- |
| `REFERRAL_REWARD_RATE`    | decimal | ❌       | `0.05`   | Доля реферера (5%)        |
| `REFERRAL_ENABLED`        | bool    | ❌       | `true`   | Включить ли программу     |
| `REFERRAL_MIN_WITHDRAWAL` | money   | ❌       | `100.00` | Минимум для вывода reward |

---

## 12a. Affiliate Program (партнёрская программа, ТЗ ч.8 §17)

> ⚠️ **env — только дефолт первого запуска.** Фактические значения живут в
> `system_settings` с префиксом `affiliate_` и правятся из админ-панели. Админка
> перекрывает env: без этого «поменял ставку в UI, а cron считает по env».
> Приоритет: индивидуальная ставка партнёра > `affiliate_default_revshare_rate` > env.

| Variable                            | Type         | Required    | Default | Description                                                                                                                                                                                            |
| ----------------------------------- | ------------ | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AFFILIATE_ENABLED`                 | bool         | ❌          | `true`  | Общий флаг программы                                                                                                                                                                                   |
| `AFFILIATE_JWT_SECRET`              | string       | **✅ prod** | —       | Секрет JWT партнёров, мин. 64 символа. **Отдельный от `JWT_ACCESS_SECRET`:** партнёрский токен имеет `aud=affiliate` и не должен открывать кабинет игрока/админа. Генерировать: `openssl rand -hex 32` |
| `AFFILIATE_JWT_ACCESS_EXPIRES_IN`   | string       | ❌          | `1h`    | TTL access-токена партнёра                                                                                                                                                                             |
| `AFFILIATE_JWT_REFRESH_EXPIRES_IN`  | string       | ❌          | `30d`   | TTL refresh-токена партнёра                                                                                                                                                                            |
| `AFFILIATE_DEFAULT_REVSHARE_RATE`   | decimal 0..1 | ❌          | `0.20`  | Ставка RevShare для НОВЫХ партнёров (20% от NGR). Нижняя граница рынка                                                                                                                                 |
| `AFFILIATE_COOKIE_DAYS`             | int 1..365   | ❌          | `30`    | Cookie-окно атрибуции, дней (рыночная норма 30–90)                                                                                                                                                     |
| `AFFILIATE_CLICK_RETENTION_DAYS`    | int 7..3650  | ❌          | `180`   | Retention кликов. **Должен быть ≥ `AFFILIATE_COOKIE_DAYS`**, иначе антифрод F1 останется без сигнала (не будет свежих кликов для сравнения IP)                                                         |
| `THROTTLE_AFFILIATE_TRACKING_LIMIT` | int          | ❌          | `120`   | Rate limit трекинг-ссылки, req/min (публичный endpoint, очень шумный)                                                                                                                                  |
| `THROTTLE_AFFILIATE_REGISTER_LIMIT` | int          | ❌          | `5`     | Rate limit регистрации партнёра, req/min                                                                                                                                                               |
| `THROTTLE_AFFILIATE_LOGIN_LIMIT`    | int          | ❌          | `10`    | Rate limit входа партнёра, req/min                                                                                                                                                                     |

---

## 13. File Uploads

| Variable               | Type | Required | Default                 | Description                       |
| ---------------------- | ---- | -------- | ----------------------- | --------------------------------- |
| `UPLOAD_DIR`           | path | ✅       | `/app/uploads`          | Директория для KYC/support файлов |
| `UPLOAD_MAX_SIZE_MB`   | int  | ❌       | `10`                    | Макс размер файла                 |
| `UPLOAD_ALLOWED_TYPES` | csv  | ❌       | `jpg,jpeg,png,pdf,webp` | Extensions                        |

---

## 14. Rate Limiting

| Variable                  | Type | Required | Default | Description                     |
| ------------------------- | ---- | -------- | ------- | ------------------------------- |
| `RATE_LIMIT_TTL_SECONDS`  | int  | ❌       | `60`    | Период rate limit               |
| `RATE_LIMIT_MAX_REQUESTS` | int  | ❌       | `60`    | Макс запросов в период          |
| `RATE_LIMIT_AUTH_MAX`     | int  | ❌       | `10`    | Auth-specific (login, register) |

---

## 15. Logging

| Variable     | Type | Required | Default     | Description                                                                                                                                                      |
| ------------ | ---- | -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`  | enum | ❌       | `info`      | `error`, `warn`, `info`, `debug`                                                                                                                                 |
| `LOG_FORMAT` | enum | ❌       | `json`      | `json` или `pretty` (для dev)                                                                                                                                    |
| `LOG_DIR`    | path | ❌       | `/app/logs` | Куда писать логи                                                                                                                                                 |
| `SENTRY_DSN` | url  | ❌       | —           | GAP-50 (вне ТЗ, согласовано владельцем): DSN проекта Sentry. Пусто/не задано — Sentry не инициализируется (no-op); уходят только необработанные исключения и 5xx |

---

## 16. Seeding (One-time)

| Variable              | Type   | Required      | Default                         | Description |
| --------------------- | ------ | ------------- | ------------------------------- | ----------- |
| `SEED_ADMIN_EMAIL`    | email  | ❌ (one-time) | `superadmin@casino.example.com` |             |
| `SEED_ADMIN_PASSWORD` | string | ❌ (one-time) | —                               | ≥ 12 chars  |

⚠️ **Удалить** `SEED_*` после первой инициализации.

---

## 17. Internal Auth

| Variable              | Type   | Required | Default | Description                   |
| --------------------- | ------ | -------- | ------- | ----------------------------- |
| `INTERNAL_API_SECRET` | string | ✅       | —       | Секрет для inter-service auth |

Используется для:

- Provider callbacks (вместо JWT)
- Admin задач по расписанию (BullMQ jobs)
- Внутренние health checks

---

## 18. Frontend (Next.js)

Frontend env доступны после `NEXT_PUBLIC_` prefix. Все остальные — только backend.

| Variable                         | Type   | Required | Default | Description                                                                               |
| -------------------------------- | ------ | -------- | ------- | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`            | URL    | ✅       | —       | `https://casino.example.com/api/v1`                                                       |
| `NEXT_PUBLIC_DOMAIN`             | string | ✅       | —       | `casino.example.com` (для cookies)                                                        |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`   | string | ✅       | —       | Google OAuth                                                                              |
| `NEXT_PUBLIC_TELEGRAM_BOT_NAME`  | string | ✅       | —       | Telegram widget                                                                           |
| `TURNSTILE_SECRET_KEY`           | string | ⬜       | —       | GAP-55 (ж): секрет Cloudflare Turnstile; пусто ⇒ капча выключена (fail-open по умолчанию) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | string | ⬜       | —       | GAP-55 (ж): публичный ключ виджета                                                        |
| `CAPTCHA_AFTER_FAILED_ATTEMPTS`  | number | ⬜       | 5       | GAP-55 (ж): после скольких неудач требовать капчу (§5.2)                                  |

| `NEXT_PUBLIC_IMAGE_HOSTS` | CSV | ⬜ | пусто | GAP-55 §22: allowlist CDN-хостов обложек для next/image (пусто → обычный `<img>`) |

---

## 19. CORS Origins

| Variable       | Type | Required | Default | Description                                                   |
| -------------- | ---- | -------- | ------- | ------------------------------------------------------------- |
| `CORS_ORIGINS` | csv  | ✅       | —       | `https://casino.example.com,https://admin.casino.example.com` |

---

## 20. Чеклист при деплое

При каждом новом деплое:

- [ ] Все `REQUIRED` переменные установлены
- [ ] `JWT_*_SECRET` ≥ 64 символов
- [ ] `RUKASSA_*` / `NOWPAYMENTS_*` / `GITSLOTPARK_*` секреты не дефолтные
- [ ] `SMTP_*` credentials протестированы
- [ ] `.env.production` НЕ в git
- [ ] CORS origins только свои домены
- [ ] APP_URL совпадает с реальным доменом (иначе OAuth redirect fail)

---

## 21. Casino & Game Providers

### 21.1. Demo Provider

| Variable                | Type | Required | Default             | Description                                                                                                              |
| ----------------------- | ---- | -------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DEMO_PROVIDER_ENABLED` | bool | ❌       | `false` (не задана) | Включить DemoProvider. Dev/staging only; в production должен быть выключен — см. README «Payment security (fail-closed)» |

Код: `apps/api/src/modules/casino/infrastructure/providers/provider-adapter.factory.ts`.

### 21.2. GitSlotPark (агрегатор слотов)

Один seamless-протокол на 4 бренда: **Pragmatic Play, PG Soft, Amatic, Amusnet**
(GAP-08). Ключи выдаёт менеджер провайдера; боевые значения приходят вместе с
контрактом. Без trio ключей любой `launch` игры этих брендов падает
**fail-closed** — `PaymentProviderNotConfiguredError` (503), а не тихая заглушка:
поднимая прод по этой доке, оператор обязан заполнить все три, иначе каталог
GitSlotPark не играется.

| Variable                 | Type   | Required                    | Default                         | Description                                                                      |
| ------------------------ | ------ | --------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `GITSLOTPARK_AGENT_ID`   | string | ✅ (для брендов агрегатора) | —                               | ID агента из контракта; участвует в подписи `userAuth`/`gamelist`                |
| `GITSLOTPARK_API_TOKEN`  | string | ✅ (для брендов агрегатора) | —                               | Токен в query-параметре `api_token`                                              |
| `GITSLOTPARK_SECRET_KEY` | string | ✅ (для брендов агрегатора) | —                               | Секрет HMAC-SHA256 для sign/verify коллбэков (bet/win/rollback/deposit/withdraw) |
| `GITSLOTPARK_API_BASE`   | URL    | ❌                          | `https://apiv2.gitslotpark.com` | База API (песочница/стенд провайдера — другой хост)                              |

Код: `apps/api/src/modules/casino/infrastructure/providers/gitslotpark/gitslotpark.adapter.ts`.

⚠️ Порядок конкатенации полей подписи по каждой из 5 callback-операций сверяется с
менеджером GSP перед боевым подключением — риск зафиксирован в GAP-43 (контракт
покрыт тестами, правка возможна только в `CALLBACK_MESSAGE_BUILDERS`).

---

## 22. Полный `.env.example`

```bash
# ── Application ────────────────────────────────────────────
NODE_ENV=development
APP_PORT=3001
APP_URL=http://localhost:3000
ADMIN_URL=http://localhost:3002
DOMAIN=localhost
ADMIN_DOMAIN=localhost
# SSL_EMAIL=admin@example.com  # опционально: email для certbot, дефолт admin@$DOMAIN

# ── Rate limiting (GAP-19) ─────────────────────────────────
THROTTLE_TTL_MS=60000
THROTTLE_GLOBAL_LIMIT=120
THROTTLE_AUTH_LIMIT=10
# /auth/refresh — зонд сессии при каждой загрузке страницы (P1 #11), мягче AUTH
THROTTLE_REFRESH_LIMIT=30
THROTTLE_ADMIN_LIMIT=5

# ── Account lockout (GAP-18) ───────────────────────────────
LOCKOUT_MAX_ATTEMPTS=10
LOCKOUT_WINDOW_MS=900000
LOCKOUT_DURATION_MS=1800000

# ── Scheduled jobs (GAP-33) ───────────────────────────────
JOB_EXPIRE_DEPOSITS_EVERY_MS=300000
JOB_UPDATE_RATES_EVERY_MS=300000
JOB_WITHDRAWAL_REMINDER_EVERY_MS=3600000
JOB_REFERRAL_DAILY_EVERY_MS=86400000
# JOB_CLEANUP_SESSIONS_EVERY_MS=3600000

# ── Database ───────────────────────────────────────────────
DATABASE_URL=postgresql://casino:casino_dev_password@localhost:5432/casino_dev
DB_USER=casino
DB_PASSWORD=casino_dev_password
DB_NAME=casino_dev
DB_POOL_SIZE=10
DB_LOG_QUERIES=false

# ── Redis ──────────────────────────────────────────────────
REDIS_URL=redis://:casino_dev_password@localhost:6379
REDIS_PASSWORD=casino_dev_password

# ── JWT ────────────────────────────────────────────────────
JWT_ACCESS_SECRET=replace_with_64_chars_random_for_development_use_only
JWT_REFRESH_SECRET=replace_with_another_64_chars_random_for_development_use_only
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
JWT_ISSUER=casino-platform
JWT_AUDIENCE_USER=user
JWT_AUDIENCE_ADMIN=admin

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
RUKASSA_WEBHOOK_URL=http://localhost:3001/api/v1/payments/webhooks/rukassa
RUKASSA_SUCCESS_URL=http://localhost:3000/wallet?deposit=success
RUKASSA_FAIL_URL=http://localhost:3000/wallet?deposit=failed
# RUKASSA_API_BASE=https://pay.rukassa.is  # optional override, code default

# ── NOWPayments ────────────────────────────────────────────
NOWPAYMENTS_API_KEY=dev_nowpayments_key
NOWPAYMENTS_IPN_SECRET=dev_ipn_secret
NOWPAYMENTS_WEBHOOK_URL=http://localhost:3001/api/v1/payments/webhooks/nowpayments
# NOWPAYMENTS_API_BASE=https://api.nowpayments.io/v1  # опционально: дефолт в коде

# ── Casino & Game Providers ─────────────────────────────────
DEMO_PROVIDER_ENABLED=true

# GitSlotPark — агрегатор Pragmatic Play / PG Soft / Amatic / Amusnet (GAP-08).
# Без trio ключей launch этих брендов падает fail-closed (см. §21.2).
GITSLOTPARK_AGENT_ID=dev_gsp_agent_id
GITSLOTPARK_API_TOKEN=dev_gsp_api_token
GITSLOTPARK_SECRET_KEY=dev_gsp_secret_key_local_testing_only
# GITSLOTPARK_API_BASE=https://apiv2.gitslotpark.com  # optional override, code default

# ── SMTP ───────────────────────────────────────────────────
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=re_xxxxxxxxxxxxx
SMTP_FROM_EMAIL=noreply@casino.example.com
SMTP_FROM_NAME=Casino Support
EMAIL_WORKER_IN_PROCESS=true

# ── KYC ────────────────────────────────────────────────────
KYC_DEPOSIT_LIMIT_RUB=5000
KYC_MIN_AGE=18
KYC_DOCUMENT_MAX_SIZE_MB=10

# ── Referral ───────────────────────────────────────────────
REFERRAL_REWARD_RATE=0.05
REFERRAL_ENABLED=true
REFERRAL_MIN_WITHDRAWAL=100

# ── Affiliate / партнёрская программа (ТЗ ч.8 §17) ──────────
AFFILIATE_ENABLED=true
AFFILIATE_JWT_SECRET=
AFFILIATE_JWT_ACCESS_EXPIRES_IN=1h
AFFILIATE_JWT_REFRESH_EXPIRES_IN=30d
AFFILIATE_DEFAULT_REVSHARE_RATE=0.20
AFFILIATE_COOKIE_DAYS=30
AFFILIATE_CLICK_RETENTION_DAYS=180
# Лимиты публичных эндпоинтов партнёрки
THROTTLE_AFFILIATE_REGISTER_LIMIT=5
THROTTLE_AFFILIATE_LOGIN_LIMIT=10
THROTTLE_AFFILIATE_TRACKING_LIMIT=120
# Фоновые задачи партнёрки
JOB_AFFILIATE_DAILY_EVERY_MS=86400000
JOB_AFFILIATE_QUALIFICATION_EVERY_MS=3600000
JOB_AFFILIATE_CLICKS_CLEANUP_EVERY_MS=86400000
# Потолок ожидания advisory-лока кошелька (GAP-57); дефолт в коде 5000
WALLET_LOCK_TIMEOUT_MS=5000

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
# SENTRY_DSN=

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
NEXT_PUBLIC_IMAGE_HOSTS=

# ── Captcha (GAP-55) ─────────────────────────────────────────
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
CAPTCHA_AFTER_FAILED_ATTEMPTS=

# ── CORS ───────────────────────────────────────────────────
CORS_ORIGINS=http://localhost:3000,http://localhost:3002
```
