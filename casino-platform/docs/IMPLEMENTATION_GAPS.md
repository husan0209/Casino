# Implementation Gaps — честный аудит ТЗ vs код

> Дата аудита: 2026-08-23. Цель: зафиксировать расхождения между ТЗ (`docs/tz-part-*.md`) и фактическим кодом.
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
| GAP-03 | Google OAuth — `throw new Error('not configured')`; контроллер отдаёт `{error:'GOOGLE_OAUTH_NOT_CONFIGURED'}` | `auth/application/use-cases/oauth/google-oauth.use-case.ts`, `auth.controller.ts` | tz-2 |
| GAP-04 | Telegram Login — аналогичная заглушка | `oauth/telegram-login.use-case.ts` | tz-2 |
| GAP-05 | ~~Email-отправка отсутствует~~ | ✅ Закрыт вместе с GAP-02: очередь+воркер+SmtpMailer; в prod без SMTP_HOST — старт невозможен (fail-closed) |
| GAP-06 | Rukassa `createPayment`: в production `throw NOT_IMPLEMENTED`, в dev — фейковый URL-stub | `payments/infrastructure/clients/rukassa.client.ts:13-24` | tz-3 |
| GAP-07 | NOWPayments `createPayment`: то же; адреса/курсы — фейковые стабы | `nowpayments.client.ts:20-44` | tz-3 |
| GAP-08 | Единственный провайдер игр — DemoProvider; фабрика бросает `ProviderNotSupportedError` на всё остальное | `casino/infrastructure/providers/provider-adapter.factory.ts` | tz-4 |
| GAP-09 | Admin sync-games возвращает `{added:0, note:'see UC-GAME-19'}` — синхронизации нет | `casino-admin.controller.ts:25-32` | tz-4 |
| GAP-10 | ~~Frontend админки — заглушки~~ | ✅ Исправлено 2026-08-23: реальный UI на 13 страницах (`apps/admin/src`): логин c JWT (zustand persist), guard-layout, дашборд на живых metrics/charts/events + Recharts, users (block/unblock), transactions, payments, withdrawals (single+batch approve/reject), KYC (approve/reject/resubmit), games/providers (toggle/sync), support (диалог+внутр.заметки+приоритет+close), referrals (stats), audit, admins (superadmin CRUD), settings. `tsc -p apps/admin` = 0 |
| GAP-11 | ~~Нет API метрик дашборда~~ | ✅ Исправлено 2026-08-23: `admin/application/dashboard.service.ts` + `AdminDashboardController` (`/admin/dashboard/metrics\|charts\|events`), raw SQL по date_trunc, деньги string. Runtime — нужна БД (prisma generate) |
| GAP-12 | ~~Нет batch approve/reject~~ | ✅ Исправлено 2026-08-23: `POST /admin/withdrawals/batch-approve\|batch-reject`, независимая обработка каждой заявки + audit-log сводки; single-эндпоинты рефакторнуты на общие helpers + `WithdrawalInvalidStatusError`(AppError) |
| GAP-13 | Referral rewards помечаются `credited` без реального зачисления через WalletFacade (деньги не движутся) | `referrals/application/referral-calc.service.ts:56-60` | UC-REF-03 шаг 5 |

## 🟡 MEDIUM — частично сделано

| # | Что | Статус |
|---|-----|--------|
| GAP-14 | `GET /admin/kyc/:id` возвращал `{todo:true}` | ✅ Исправлено 2026-08-22: возвращает профиль+документы+`totalDepositedRub` (`kyc-admin.controller.ts`) |
| GAP-15 | NotificationService игнорировал настройки и канал email | ⚠️ Частично: проверка `user_settings.notificationsEmail` добавлена; реальная отправка ждёт GAP-02/05 |
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

## ⚠️ Параллельная разработка
2026-08-23: во время работ обнаружены чужие коммиты в рабочем дереве (модуль `geo`, `deposit-profile.service`, правки kyc/payments/users) с импортами ещё не существующих экспортов `@casino/shared-config` (CURRENCY_LIMITS, GEO_PROFILES, resolveLegalCountry…). На момент фиксации API-tsc из-за них ≠ 0; это не регрессия задач выше. Координировать: добавить экспорты в shared-config или дождаться завершения параллельной задачи.

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
| Доки описывают схему Prisma как `prisma/schema/<area>.prisma` и `turbo.json` — в реальности один `schema.prisma` и turbo нет | ⚠️ расхождение доков учтено в новых AGENTS.md/.cursorrules; поправить доки |

## Порядок восстановления (рекомендация)

1. GAP-01: восстановить infra/domain слой auth (hasher argon2, JWT access/refresh rotation, prisma-репозитории под существующий `schema.prisma`, register use-case) — иначе ничего не проверить.
2. GAP-02+05: BullMQ email queue + nodemailer-воркер + шаблоны из tz-6 §15.
3. GAP-11/12: dashboard metrics/charts/events + batch endpoints — они разблокируют реальный UI админки.
4. GAP-10: реализовать страницы админки на уже готовом backend API (users/finance/support/referrals работают).
5. GAP-03/04: OAuth по ключам из env (уже есть в schema env.validation).
6. GAP-06/07: реальные интеграции Rukassa/NOWPayments по их API-докам (верификация подписей уже написана).
7. GAP-08: минимум один реальный провайдер через ProviderAdapter (см. PROVIDER_INTEGRATION_STRATEGY.md).
