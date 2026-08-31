# Implementation Gaps — честный аудит ТЗ vs код

> Дата аудита: 2026-08-23, ревизия 2026-08-24. Цель: зафиксировать расхождения между ТЗ (`docs/tz-part-*.md`) и фактическим кодом.
> Этот файл — точка правды по статусу. Не отмечать пункт «готов», пока не работает end-to-end.

## 🔴 CRITICAL — блокеры (API не собирается)

### GAP-01. ✅ ИСПРАВЛЕНО 2026-08-23 — модуль auth достроен
Восстановлены отсутствующие файлы по контрактам существующих use-case'ов:
- `domain/errors.ts` — AppError-классы (INVALID_CREDENTIALS, EMAIL_NOT_VERIFIED, TOKEN_*, SESSION_* …)
- `domain/entities/user.entity.ts`, `domain/repositories/{user,session,auth-provider,verification-token}.repository.ts` (+ index barrel)
- `infrastructure/services/password-hasher.service.ts` (argon2id), `jwt.service.ts` (HS256 на node:crypto — jsonwebtoken недоступен в оффлайн-store), `email-queue.service.ts` (dev=лог со ссылкой, prod без SMTP_HOST=fail-closed EmailNotConfiguredError)
- `infrastructure/repositories/*.prisma.ts` ×4
- `application/use-cases/register.use-case.ts` (уникальность email, реферальный код 8 симв. UC-REF-01/02, verification-токен 24ч)
- Попутно починен `admin/infrastructure/admin-jwt.service.ts` (импортировал отсутствующий jsonwebtoken → HS256 на crypto)
- **Проверка:** `tsc --noEmit` для @casino/api — 0 ошибок. Runtime-проверка (реальный регистр/логин) требует БД+Redis — не выполнялась в этой среде.
Также исправлены попутные пре-существующие баги сборки: битый путь импорта zod-validation.pipe в auth.controller (`../../../`→`../../../../`), тип meta в shared-types ApiSuccessResponse (+PaginationMeta), ~25 strict-mode ошибок TS7006/7031/6133 в старых модулях, ambient-типы multer (см. Environment).

### GAP-02. ✅ ИСПРАВЛЕНО 2026-08-23 — BullMQ-инфраструктура реализована
`apps/api/src/queues/`:
- `queue.types.ts` — `EMAIL_QUEUE_PORT`, `EmailJobData`, `EnqueueResult`
- `infrastructure/email.queue.ts` — продюсер `BullMqEmailQueue` (attempts 5, backoff exp 5s, removeOnComplete/Fail) + fallback `DevLogEmailQueue`
- `infrastructure/smtp.mailer.ts` — `MAILER_PORT`: `SmtpMailer` (nodemailer ленивым require — optional peer) / `DevLogMailer`; в production без `SMTP_HOST` приложение не стартует (fail-closed)
- `application/email.worker.ts` — консьюмер очереди `email` (тот же процесс, MVP), проставляет `notifications.sentAt`
- Подключены producers: auth (`EmailQueueService` → verify/reset письма с HTML), notifications (UC-NOTIF-01, проверка `user_settings.notificationsEmail`)
- env: добавлены опциональные `SMTP_PORT/SMTP_USER/SMTP_PASS`
- **Проверка:** tsc 0 ошибок. Runtime (реальная отправка) требует Redis+SMTP на Linux-FS среде.
- Осталось после MVP: вынос воркера в отдельный процесс, rich HTML-шаблоны (`templates/index.ts` — пока plain text).

## 🟠 HIGH — фичи заявлены, но не работают

| # | Gap | Где | TZ |
|---|-----|-----|----|
| GAP-03 | ~~Google OAuth — заглушка~~ | ✅ Реализовано 2026-08-24: authorization-code flow (`GET /auth/google/url` со state=HMAC 10 мин; `POST /auth/google` — обмен кода, userinfo, провижининг через `OAuthUserProvisioningService`, сессия+refresh-cookie). Требует `GOOGLE_CLIENT_ID/SECRET`. Runtime не проверялся (нет сети/ключей в среде) |
| GAP-04 | ~~Telegram Login — заглушка~~ | ✅ Реализовано 2026-08-24: `POST /auth/telegram` — верификация виджета (secret=SHA256(bot_token), HMAC data-check-string, timingSafeEqual, auth_date ≤24ч), пользователь без email (schema nullable), сессия. Требует `TELEGRAM_BOT_TOKEN` |
| GAP-05 | ~~Email-отправка отсутствует~~ | ✅ Закрыт вместе с GAP-02: очередь+воркер+SmtpMailer; в prod без SMTP_HOST — старт невозможен (fail-closed) |
| GAP-06 | ~~Rukassa createPayment — заглушка~~ | ✅ Реализовано 2026-08-24: реальный HTTP (`POST {RUKASSA_API_BASE|pay.rukassa.is}/api/v1/order/create`, заголовки shop_id/api_key, timeout 30с), getPaymentStatus; dev без ключей — лог-стаб. Верификация вебхука HMAC-SHA256 активна в prod (раньше кидала NOT_IMPLEMENTED). Runtime — нужны боевые ключи |
| GAP-07 | ~~NOWPayments — стабы~~ | ✅ Реализовано 2026-08-24: `POST /v1/payment` (x-api-key), `/estimate`, `/payment/{id}`; курсы больше не хардкод при наличии ключа; IPN HMAC-SHA512 активен в prod. Env: `NOWPAYMENTS_API_BASE`. Runtime — нужен NOWPAYMENTS_API_KEY |
| GAP-08 | ~~Только DemoProvider~~ | ✅ Код готов 2026-08-24: адаптер **GitSlotPark** (`gitslotpark.adapter.ts`) — агрегатор Pragmatic Play/PG Soft/Amatic/Amusnet (один seamless-протокол на 4 бренда). userAuth/gamelist + callback-операции GetBalance/Withdraw/Deposit/BetWin/Rollback с HMAC-SHA256-sign, маршруты `/provider-callback/gitslotpark/{Op}`. ⚠️ До продакшена: сверить порядки конкатенации sign по каждой операции с менеджером GSP; связка `userID→сессия` в GameCallbackService и атомарность BetWin — проверить runtime с тестовыми ключами |
| GAP-09 | ~~Admin sync-games — заглушка~~ | ✅ Реализовано 2026-08-24: `syncGames` вызывает `adapter.fetchGameList()`, upsert по `[providerId, externalGameId]`, slug = name+md5-суффикс, обновляет rtp/thumbnail/hasDemo/metadata, пересчитывает gameCount; новые игры создаются выключенными (UC-GAME-19). Кнопка «Синхронизировать» в UI админки уже показывает результат |
| GAP-10 | ~~Frontend админки — заглушки~~ | ✅ Исправлено 2026-08-23: реальный UI на 13 страницах (`apps/admin/src`): логин c JWT (zustand persist), guard-layout, дашборд на живых metrics/charts/events + Recharts, users (block/unblock), transactions, payments, withdrawals (single+batch approve/reject), KYC (approve/reject/resubmit), games/providers (toggle/sync), support (диалог+внутр.заметки+приоритет+close), referrals (stats), audit, admins (superadmin CRUD), settings. `tsc -p apps/admin` = 0 |
| GAP-11 | ~~Нет API метрик дашборда~~ | ✅ Исправлено 2026-08-23: `admin/application/dashboard.service.ts` + `AdminDashboardController` (`/admin/dashboard/metrics\|charts\|events`), raw SQL по date_trunc, деньги string. Runtime — нужна БД (prisma generate) |
| GAP-12 | ~~Нет batch approve/reject~~ | ✅ Исправлено 2026-08-23: `POST /admin/withdrawals/batch-approve\|batch-reject`, независимая обработка каждой заявки + audit-log сводки; single-эндпоинты рефакторнуты на общие helpers + `WithdrawalInvalidStatusError`(AppError) |
| GAP-13 | Referral rewards помечаются `credited` без реального зачисления через WalletFacade (деньги не движутся) | `referrals/application/referral-calc.service.ts:56-60` | UC-REF-03 шаг 5 |

## 🛡 АУДИТ 2026-08-25 → открытые пункты (ревизия 2026-08-28)

> Полный снимок аудита с ревизией каждого пункта: **`docs/archive/audit-2026-08-25.md`**.
> Из 30 пунктов аудита **17 исправлены** (список в снимке), открытые — перенесены сюда:

| # | Audit ID | Что | Где | Приоритет |
|---|----------|-----|-----|-----------|
| GAP-18 | N2 | ~~Account lockout после N неудачных логинов (SECURITY_BASELINE §2.3: 10 за 15 мин → блок 30 мин)~~ | `auth/application/use-cases/login.use-case.ts` | ✅ P1 закрыт 2026-08-30: поля `failed_login_attempts/last_failed_at/locked_until` (миграция `20260830_account_lockout.sql` — применить при деплое); 10 неудач/15 мин → блок 30 мин; enumeration-safe (неверный пароль → всегда INVALID_CREDENTIALS, лок виден только при верном); уже заблокированный аккаунт не продлевается (DoS-защита); юнит-тесты `test/account-lockout.spec.ts`. Env: `LOCKOUT_MAX_ATTEMPTS/WINDOW_MS/DURATION_MS` |
| GAP-19 | N3 | ~~ThrottlerModule (app-level rate limit)~~ | `app.module.ts`, `apps/api/package.json` | ✅ P0 закрыт 2026-08-30: `@nestjs/throttler` v6, глобальный `ThrottlerGuard` (APP_GUARD) 120 req/мин на IP; `/auth/*` строже — `@Throttle` 10/мин; webhook'и провайдеров и game-callback — `@SkipThrottle()` (у них HMAC). Env: `THROTTLE_TTL_MS`, `THROTTLE_GLOBAL_LIMIT`, `THROTTLE_AUTH_LIMIT` |
| GAP-20 | N4 | ~~helmet() middleware~~ | `main.ts`, `apps/api/package.json` | ✅ P0 закрыт 2026-08-30: `app.use(helmet())` в bootstrap до парсеров; API отдаёт только JSON → дефолтный CSP безопасен, `frame-ancestors 'none'` против clickjacking |
| GAP-21 | N8, N9, C3 | ~~Zod-валидация на всех `@Body` inputs~~ | `apps/api/src/modules/*/presentation/controllers/` | ✅ P1 закрыт 2026-08-30: `@UsePipes(new ZodValidationPipe(Schema))` на всех клиентских `@Body` (auth incl. google/telegram, users profile/settings/self-exclude, casino launch/demo, kyc submit/documents, support + support-admin, все admin-контроллеры incl. finance credit/debit/batch). Новые DTO-схемы по модулям; неизвестные ключи вырезаются (anti mass-assignment). **Exempt (задокументировано в коде):** `payments-webhook` и `provider-callback` — payload'ы провайдеров под HMAC, жёсткая схема отбила бы валидные коллбэки |
| GAP-22 | A1, C5, C6 | Wallet-модуль: вынести lock/unlock/confirmWithdrawal в `application/use-cases/` (4-слойка); убрать `toMoney(n: any)` (`wallet.ledger.prisma.ts:21`); разбить `runCreditDebit` (~50 строк > 30). **2026-08-30: G1-часть закрыта** — репозитории извлечены для casino (IGameCatalog/IGameFavorites/IGamePlay), notifications (INotification), referrals (IReferral), users (IUserSettings), admin (IAdminUser/IAuditLog/IDashboard); prisma — только в infrastructure; cross-module чтения помечены TODO(GAP-22) на Facade | `modules/wallet/` | P2 |
| GAP-23 | H6 | ~~Pino + redact вместо Nest Logger (пароли/токены могут попасть в логи)~~ | `apps/api/src/common/logger/logger.options.ts` | ✅ P1 закрыт 2026-08-30: `nestjs-pino` + pino-http по всему Nest (`useLogger`); redact-пути `password/token/authorization/cookie/set-cookie` на 3 уровнях вложенности + `req.body.*`; кастомный req-сериализатор (body в логах — но с redact); `GlobalExceptionFilter` больше не логирует `err` целиком (только type/message/stack через PinoLogger); корреляция request-id между pino и RequestIdMiddleware через общий `resolveRequestId`; env `LOG_LEVEL`/`LOG_FORMAT` подключены (pretty в dev, json в prod). Тесты `test/logger-redact.spec.ts` — секреты физически отсутствуют в выводе лога |
| GAP-24 | A5, A6 | ~~Покрытие тестами: минимум — money flow + idempotency~~ | `apps/api` | 🔶 P2 в основном закрыт 2026-08-30: `money-flow.spec.ts` (11), `ledger.integration.spec.ts` (6 на реальном Postgres, в CI `prisma db push` + `LEDGER_INTEGRATION=1` — откат tx при сбое и idempotency проверены на Serializable-БД), `nowpayments-ipn.spec.ts` (13), `kyc-file-sniffer.spec.ts` (8), `account-lockout.spec.ts` (5), `logger-redact.spec.ts` (3); осталось E2E (GAP-05) |
| GAP-25 | A7 | Довести ESLint до обещанного в QUALITY_GATES §2.1: `max-params` warn(4)→error(3), `complexity` warn(10)→error(10) | `.eslintrc.js:66,70` | P2 |
| GAP-26 | C4 | Относительные импорты `../../../../` → path aliases (18 мест) | `apps/api/src/modules/**` | P3 |
| GAP-27 | NEW | ~~argon2 без явных параметров~~ | `password-hasher.service.ts:7` | ✅ P1 закрыт 2026-08-30: `PasswordHasher.hash` → `argon2.hash(plain, {type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4})` (совпадает с SECURITY_BASELINE §2.1 и admin-хэшером `admin-users.service.ts:28`) |
| GAP-28 | H4 | Идемпотентность депозита: `deposit_${pr.id}` — добавить защиту и по `external_id` (defense-in-depth, P3) | `process-rukassa-webhook.use-case.ts:48` | P3 |
| GAP-29 | NEW (docs-guard D3) | env.validation.ts валидирует не все ключи `.env.example` (конкретный список — в выводе docs-guard D3) — дополнить Zod-схему | `packages/shared-config/src/env.validation.ts` | P3 |
| GAP-30 | NEW (PR-0) | 14 методов 61–88 строк (prettier-инфляция после `--fix`): `game-callback.service` bet/win/rollback, `dashboard.service` metrics/events, `wallet.ledger.prisma` runCreditDebit/lock/unlock/confirmWithdrawal, `list-games.use-case` execute, webhook execute ×2, `provider-callback.controller` handle — разбить на приватные методы, вернуть лимит 60. Делать вместе с тестами (GAP-21/24) | перечисленные файлы | P3 |

## 🟡 MEDIUM — частично сделано

| # | Что | Статус |
|---|-----|--------|
| GAP-14 | `GET /admin/kyc/:id` возвращал `{todo:true}` | ✅ Исправлено 2026-08-22: возвращает профиль+документы+`totalDepositedRub` (`kyc-admin.controller.ts`) |
| GAP-15 | ~~NotificationService игнорировал настройки и канал email~~ | ✅ Закрыто в рамках GAP-02: enqueue в очередь `email` с проверкой `user_settings.notificationsEmail`; sentAt проставляет воркер |
| GAP-16 | README врал про `[x]` во всех частях | ✅ Исправлено: честные проценты + ссылка сюда |
| GAP-17 | KYC upload UI есть, но лимит 5000₽ проверяется только на бэке при депозите — сверить с kyc-check.service | ⚠️ Нужен `limit_remaining` в активной валюте для UI (tz-part-2 §4, tz-part-5 §13) |

## 📋 TZ SYNC — расхождения после обновления Part 5 (2026-08-23)

> ТЗ части 1–7 и PAYMENT_OVERVIEW синхронизированы с новой [tz-part-5](tz-part-5-frontend-web.md). Ниже — что **ещё не реализовано в коде**.

| # | Требование ТЗ | Статус кода |
|---|---------------|-------------|
| TZ-01 | `GET /api/v1/geo/config` — методы по гео/валюте | ✅ GeoModule + shared-config geo profiles |
| TZ-02 | MVP валюты: RUB + USDT_TRC20 + BTC; TON/TRX/LTC убраны из релиза | ⚠️ Публичный exchange-rates убран; проверить NOWPayments client |
| TZ-03 | `last_payment_method` на профиле для сортировки кассы | ✅ schema + DepositProfileService; нужна миграция БД |
| TZ-04 | KYC API: `limit_remaining` + `?currency=` | ✅ GetKycStatusUseCase обновлён |
| TZ-05 | Крипто-депозит: зачисление факта, не exact amount | ⚠️ webhook уже uses actually_paid |
| TZ-06 | Launch: `CURRENCY_NOT_SUPPORTED`, кросс-валютный запрет | ✅ LaunchGameUseCase + InsufficientFunds → DepositSheet на web |
| TZ-07 | Frontend web (`apps/web`) по новому Part 5 | ⚠️ Старт: header, sheets, geo/wallet stores, home slot-first |
| TZ-08 | Phase 2 фиат UAH/BYN/KZT/UZS | 📌 GeoConfig готов, fiatLive=false до PSP |
| TZ-09 | Приёмка 90 сек: geo presets, deposit `currency`+`method` | ⚠️ Backend готов; web flow частично (register→launch→deposit) |
| TZ-10 | Register → сразу сессия без email-тупика | ✅ RegisterUseCase + auth store |

## Параллельная разработка — РАЗРЕШЕНО 2026-08-24
Работа второго агента (Copilot) слита: geo-модуль, deposit-profile, web-компоненты (`d7a923d`). Экспорты `shared-config/geo.config.ts` добавлены, два битых относительных пути починены, полный monorepo tsc = 0, всё в main (`8473f59a`).

Продуктовое решение агента (TZ-10): регистрация выдаёт сессию сразу, gate `emailVerified` в LoginUseCase снят, RegisterUseCase переписан (сессия + access-token немедленно); письмо-верификация идёт по очереди как информационное. Если для рынка СНГ верификация обязательна ДО игры — вернуть gate и выдавать сессию после verify-email.

## Environment — особенности этой машины (Android SD-card)

- `/mnt/sdcard` = Android FUSE: **symlinks запрещены** → pnpm не может линковать `.bin`; `pnpm install` падает EACCES. В `.npmrc` добавлен `bin-links=false`.
- Оффлайн-store без registry: `jsonwebtoken`, `@types/multer` недоступны → JWT реализован на node:crypto, multer покрыт временным shim'ом `apps/api/src/types/multer*.d.ts` (удалить после `pnpm add -D @types/multer`).
- **Prisma client в этой среде НЕ сгенерирован** (`prisma generate` требует完整 store) — типы БД проверялись через hoisted-копию; на нормальной Linux-FS выполнить: `pnpm install && pnpm db:generate && pnpm db:migrate`.

## Структура проекта — найдено и исправлено 2026-08-22

| Проблема | Статус |
|---|---|
| `docs/INDEX.md`: битые ссылки на `../tz-part-*.md` (файлы лежат в `docs/`) | ✅ исправлено |
| В корне отсутствовали машинно-читаемые инструкции агента (`AGENTS.md`, `.cursorrules`), хотя `docs/AGENT_INSTRUCTIONS.md` предписывает их создать | ✅ созданы из §1/§2 того же документа |
| Мусор вне git-репо: `/mnt/sdcard/Casino/apps` (пустой), `/mnt/sdcard/Casino/home`, `/mnt/sdcard/Casino/uploads` (старые .txt копии доков от 2026-07-17) | ⚠️ не тронуто — решить владельцу |
| `.env` лежит на диске, но не закоммичен (в git только `.env.example`) | ✅ ок |
| Доки описывали схему Prisma как `prisma/schema/<area>.prisma` и `turbo.json` — в реальности один `schema.prisma` и turbo нет | ✅ Исправлено 2026-08-28: AGENT_INSTRUCTIONS/MODULE_TEMPLATE/.cursorrules приведены к единому `schema.prisma`, упоминания turbo убраны, `events.ts` → `apps/api/src/queues/queue.types.ts` |

## Остаток работ (ревизия 2026-08-28)

1. ~~**GAP-19/20/27** — Throttler + Helmet + argon2-параметры~~ ✅ закрыто 2026-08-30 (`security/gap-19-20-27`).
2. **GAP-18 ✅ / GAP-21 ✅ / GAP-23 ✅** — lockout, Zod и Pino redact закрыты 2026-08-30. **P0 #3 (атомарность денег) и P0 #4 (NOWPayments IPN — канонический sorted-JSON HMAC) закрыты 2026-08-30**. Осталось: E2E (GAP-05), sandbox-прогон NOWPayments перед боевыми ключами.
3. **GAP-08/09 runtime** — сверка sign-порядков с менеджером GitSlotPark + runtime-тест с ключами.
4. **GAP-03/04** — Google/Telegram OAuth: код готов, нужны ключи + runtime-проверка.
5. **Runtime-приёмка** на Linux-FS: `pnpm install && pnpm db:generate && pnpm db:migrate && pnpm dev`; прогон register→login→deposit→launch→admin.
6. Решение по email-верификации (см. заметку о TZ-10 выше).
7. После MVP: GAP-22/24/25/26 (wallet-рефактор, тесты, ESLint, импорты), GAP-28; email-воркер отдельным процессом, rich HTML-шаблоны.
