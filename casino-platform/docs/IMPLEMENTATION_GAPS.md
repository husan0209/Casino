# Implementation Gaps — честный аудит ТЗ vs код

> Дата аудита: 2026-08-22. Цель: зафиксировать расхождения между ТЗ (`docs/tz-part-*.md`) и фактическим кодом.
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

### GAP-02. Очереди пустые
`apps/api/src/queues/queues.module.ts` — заглушка «to be enabled in Part 6». Нет BullMQ producers/consumers: email, notifications, exchange-rates, expire-payments, referral-rewards.

## 🟠 HIGH — фичи заявлены, но не работают

| # | Gap | Где | TZ |
|---|-----|-----|----|
| GAP-03 | Google OAuth — `throw new Error('not configured')`; контроллер отдаёт `{error:'GOOGLE_OAUTH_NOT_CONFIGURED'}` | `auth/application/use-cases/oauth/google-oauth.use-case.ts`, `auth.controller.ts` | tz-2 |
| GAP-04 | Telegram Login — аналогичная заглушка | `oauth/telegram-login.use-case.ts` | tz-2 |
| GAP-05 | Email-отправка отсутствует (нет SMTP-клиента и воркера; после GAP-01/GAP-02 письма некому слать) | `notifications/application/notification.service.ts` | tz-2, tz-6 §11 |
| GAP-06 | Rukassa `createPayment`: в production `throw NOT_IMPLEMENTED`, в dev — фейковый URL-stub | `payments/infrastructure/clients/rukassa.client.ts:13-24` | tz-3 |
| GAP-07 | NOWPayments `createPayment`: то же; адреса/курсы — фейковые стабы | `nowpayments.client.ts:20-44` | tz-3 |
| GAP-08 | Единственный провайдер игр — DemoProvider; фабрика бросает `ProviderNotSupportedError` на всё остальное | `casino/infrastructure/providers/provider-adapter.factory.ts` | tz-4 |
| GAP-09 | Admin sync-games возвращает `{added:0, note:'see UC-GAME-19'}` — синхронизации нет | `casino-admin.controller.ts:25-32` | tz-4 |
| GAP-10 | Frontend админки: 12 страниц-заглушек («Раздел админки — Часть 6.»), дашборд с захардкоженными цифрами, логин — кнопка «Войти (dev)» без вызова `/admin/auth/login` | `apps/admin/src/app/**` | tz-6 §4,16 |
| GAP-11 | Нет API метрик дашборда: `/admin/dashboard/metrics\|charts\|events` | отсутствуют | UC-ADMIN-DASH-01..03 |
| GAP-12 | Нет batch approve/reject выводов | `admin-finance.controller.ts` | UC-ADMIN-FIN-05 |
| GAP-13 | Referral rewards помечаются `credited` без реального зачисления через WalletFacade (деньги не движутся) | `referrals/application/referral-calc.service.ts:56-60` | UC-REF-03 шаг 5 |

## 🟡 MEDIUM — частично сделано

| # | Что | Статус |
|---|-----|--------|
| GAP-14 | `GET /admin/kyc/:id` возвращал `{todo:true}` | ✅ Исправлено 2026-08-22: возвращает профиль+документы+`totalDepositedRub` (`kyc-admin.controller.ts`) |
| GAP-15 | NotificationService игнорировал настройки и канал email | ⚠️ Частично: проверка `user_settings.notificationsEmail` добавлена; реальная отправка ждёт GAP-02/05 |
| GAP-16 | README врал про `[x]` во всех частях | ✅ Исправлено: честные проценты + ссылка сюда |

## Environment — особенности этой машины (Android SD-card)

- `/mnt/sdcard` = Android FUSE: **symlinks запрещены** → pnpm не может линковать `.bin`; `pnpm install` падает EACCES. В `.npmrc` добавлен `bin-links=false`.
- Оффлайн-store без registry: `jsonwebtoken`, `@types/multer` недоступны → JWT реализован на node:crypto, multer покрыт временным shim'ом `apps/api/src/types/multer*.d.ts` (удалить после `pnpm add -D @types/multer`).
- **Prisma client в этой среде НЕ сгенерирован** (`prisma generate` требует完整 store) — типы БД проверялись через hoisted-копию; на нормальной Linux-FS выполнить: `pnpm install && pnpm db:generate && pnpm db:migrate`.
| GAP-17 | KYC upload UI есть, но лимит 5000₽ проверяется только на бэке при депозите — сверить с kyc-check.service | уточнить |

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
