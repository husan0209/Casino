---
title: Module Boundaries
description: Границы между модулями backend casino-platform
status: living document
last_updated: 2026-09-28
---

# Module Boundaries

> **Назначение:** Карта модулей, их ответственности, и правил общения. **Прочитать ПЕРЕД созданием нового use case.**

---

## 1. Карта модулей

Фактические каталоги — `apps/api/src/modules/`: **13 модулей** — admin, auth,
casino, geo, health, kyc, maintenance, notifications, payments, referrals,
support, users, wallet. Game-sessions — часть casino (§8), audit-log — часть
admin (§12); отдельных каталогов под них нет.

```
┌──────────────────────────────────────────────────────────────────┐
│                          Backend                                  │
│                                                                   │
│   ┌──────┐ ┌───────┐ ┌─────┐ ┌────────┐ ┌──────────┐ ┌─────┐   │
│   │ auth │ │ users │ │ kyc │ │ wallet │ │ payments │ │ geo │   │
│   └──────┘ └───────┘ └─────┘ └────────┘ └──────────┘ └─────┘   │
│                                                                   │
│   ┌──────────────────────────┐ ┌───────────┐ ┌─────────┐        │
│   │ casino (+ game-sessions) │ │ referrals │ │ support │        │
│   └──────────────────────────┘ └───────────┘ └─────────┘        │
│                                                                   │
│   ┌───────────────┐ ┌─────────────────┐                          │
│   │ notifications │ │ admin (+ audit) │                          │
│   └───────────────┘ └─────────────────┘                          │
│                                                                   │
│   ┌────────┐ ┌─────────────┐                                     │
│   │ health │ │ maintenance │                                     │
│   └────────┘ └─────────────┘                                     │
│                                                                   │
│   BullMQ-очереди (не модули): email, maintenance                  │
│   (планировщик/воркер maintenance — §18)                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Auth Module

### 2.1. Ответственность

- Регистрация пользователей (email, Google, Telegram)
- Вход / Logout
- Refresh tokens
- Email verification flow
- Password reset flow
- Session management

### 2.2. Ключевые Use Cases

| UC | Описание |
|----|----------|
| UC-AUTH-01 | Регистрация через email |
| UC-AUTH-02 | Email verification |
| UC-AUTH-03 | Login через email |
| UC-AUTH-04 | Refresh token rotation |
| UC-AUTH-05 | Logout (invalidate refresh) |
| UC-AUTH-06 | Google OAuth login/register |
| UC-AUTH-07 | Telegram login |
| UC-AUTH-08 | Forgot password |
| UC-AUTH-09 | Reset password |
| UC-AUTH-10 | Change password |

### 2.3. Использует

- `queues` (EMAIL_QUEUE_PORT — постановка verification/reset писем в BullMQ-очередь `email`; отправка — EmailWorker)
- Referral code при регистрации генерируется в самом `register.use-case` (собственный `IUserRepository`); модули `users`/`notifications`/`referrals` auth НЕ импортирует

### 2.4. Используется в

- Почти все модули импортируют `AuthModule` ради `AuthGuard`/`RolesGuard` (users, geo, kyc, wallet, payments, casino, referrals, support, notifications)
- `admin` — НЕ использует auth (отдельный admin-JWT flow, см. §13)

### 2.5. Экспортирует

- `AuthGuard`, `RolesGuard` (+ декоратор `Roles`) — `auth/presentation/guards/`
- `JwtTokenService` — выпуск/верификация access+refresh (exports из `auth.module.ts`)
- NB: `CurrentUser` decorator живёт вне модуля — `apps/api/src/common/decorators/current-user.decorator.ts`

---

## 3. Users Module

### 3.1. Ответственность

- Профиль пользователя (имя, фамилия, DOB, country, city)
- Avatar upload
- Settings (notifications on/off, language)
- Управление сессиями (просмотр, terminate)

### 3.2. Ключевые таблицы

```
users                (основная, базовая — id, email, status, role)
user_profiles        (1:1 к users — имя, DOB и т.д.)
user_settings        (1:1 — preferences)
sessions             (refresh tokens hashed)
```

### 3.3. Использует

- Ничего критичного (большинство операций — обновление своих таблиц)

### 3.4. Используется в

- `geo` (UsersFacade.getGeoContext)
- `payments` (UsersFacade — контекст пользователя, onDepositCompleted)

### 3.5. Экспортирует

- `UsersFacade` (getGeoContext, updateCurrencyPreference, onDepositCompleted) — `users/facade/users.facade.ts`
- `SelfExclusionUseCase` (самоисключение игрока)
- NB: таблица `sessions` общая с auth — чтение/отзыв сессий здесь через `USER_SESSION_REPOSITORY`, выпуск refresh-токенов — в auth (`SESSION_REPOSITORY`)

---

## 3a. Geo Module

### 3a.1. Ответственность

- Geo-конфиг для кассы: legal country, активная валюта, методы оплаты
- Пресеты и лимиты депозита по валюте
- Display-конвертация RUB → активная валюта (KYC UI, без конвертации в player wallet UI)

### 3a.2. Ключевые Use Cases

| UC | Описание |
|----|----------|
| UC-GEO-01 | GET /geo/config — конфиг для гостя / авторизованного |
| UC-GEO-02 | Валидация фиатного метода депозита |
| UC-GEO-03 | RUB → display currency (KYC limit_remaining) |

### 3a.3. Использует

- `users` (UsersFacade — currency_preference, last_payment_method, country)

### 3a.4. Используется в

- `payments` (GeoFacade)
- `kyc` (GeoFacade)

### 3a.5. Экспортирует

- `GeoFacade` (convertRubToDisplay и др.) — `geo/facade/geo.facade.ts`
- `ExchangeRatesService` — чтение `exchange_rates` (таблицу пишет maintenance-джоба `update-rates`, §18)

---

## 4. KYC Module

### 4.1. Ответственность

- Форма подачи KYC
- Загрузка документов
- Статусы: not_started → pending → approved/rejected/requires_resubmission
- Лимит 5000 RUB суммарного депозита без approved KYC

### 4.2. Ключевые таблицы

```
kyc_profiles         (1:1 к users — статус, last_reviewed_at)
kyc_documents        (документы — front/back/selfie)
```

### 4.3. Использует

- `geo` (GeoFacade.convertRubToDisplay — display limit_remaining в KYC UI)
- `admin` (AdminAuthGuard — для admin-review endpoints) и `auth` (AuthGuard/RolesGuard)
- NB: `notifications` и `audit` kyc-модуль НЕ импортирует (письма о смене статуса и audit-лог в коде не вызываются)

### 4.4. Используется в

- `payments` (KycCheckService.assertCanDeposit / assertCanWithdraw)
- Admin-API review — `KycAdminController` живёт внутри kyc-модуля (пути `admin/kyc/...`), а не в admin-модуле

### 4.5. Экспортирует

- `KycCheckService` — `assertCanDeposit(userId, amountRub)`, `assertCanWithdraw(userId)`

---

## 5. Wallet Module

### 5.1. Ответственность

- Кошельки по валютам (1 user × N currencies)
- Operations: credit, debit, lock, unlock, confirmWithdrawal
- Optimistic locking через `version` field
- Ledger (append-only) для всех операций
- `runInTransaction` — атомарные проводки в одном Prisma-tx (используется casino при bet/win)
- NB: display-конвертация валют — НЕ здесь: курсы `exchange_rates` пишет maintenance (§18), читает `geo` (ExchangeRatesService)

### 5.2. Ключевые таблицы

```
wallet_accounts      (userId × currency — balance, locked, version)
ledger_entries       (append-only — каждая операция)
```

`exchange_rates` — отдельная таблица: запись — `maintenance` (§18), чтение — `geo`.

### 5.3. Использует

- Ничего из модулей (импортирует только `AuthModule` ради guard) — foundational module

### 5.4. Используется в

- `payments` (credit при deposit, debit при withdrawal)
- `casino` (debit при bet, credit при win, rollback — включая game-sessions callbacks, §8)
- `referrals` (credit при reward)
- `admin` (manual credit/debit)

### 5.5. Экспортирует

- `WalletFacade` — основная surface для других модулей
- `credit({userId, currency, amount, type, idempotencyKey})`
- `debit({userId, currency, amount, type, idempotencyKey})`
- `lock({userId, currency, amount})`
- `unlock({userId, currency, amount})`
- `confirmWithdrawal({userId, currency, amount, withdrawalRequestId})`
- `getBalance(userId, currency)`
- `getBalances(userId)`
- `runInTransaction(fn)` — групповые проводки (casino bet/win)

Класс — `wallet/application/wallet.facade.ts`.

### 5.6. КРИТИЧНО

Wallet facade — **ЕДИНСТВЕННЫЙ СПОСОБ** изменить баланс. Никогда не делать:

```typescript
❌ await prisma.walletAccount.update({
  where: { userId_currency: { userId, currency } },
  data: { balance: { increment: amount } }
})
```

Всегда:

```typescript
✅ await walletFacade.credit({
  userId, currency, amount, type: 'DEPOSIT',
  idempotencyKey: `dep_${paymentRequestId}`,
})
```

---

## 6. Payments Module

### 6.1. Ответственность

- Создание payment_requests (deposit / withdraw)
- Интеграция с providers (Rukassa, NOWPayments, Manual)
- Обработка webhooks (idempotent)
- Сохранение raw callbacks до обработки
- KYC limit check для deposit
- KYC required для withdraw

### 6.2. Providers

```
RukassaClient         — фиат (RUB через карты, СБП, P2P)
NOWPaymentsClient     — крипто (USDT/BTC/TON/TRX/LTC); клиент переиспользует maintenance (§18)
```

Manual-кредита как отдельного адаптера нет: ручное начисление — через admin
(`AdminFinanceController` → `WalletFacade.credit`, §13).

### 6.3. Ключевые таблицы

```
payment_requests     (все платежи — статус, провайдер, externalId)
payment_callbacks    (raw callbacks от провайдеров)
```

### 6.4. Использует

- `wallet` (WalletFacade — credit/debit/lock при confirm payments)
- `kyc` (KycCheckService.assertCanDeposit / assertCanWithdraw)
- `users` (UsersFacade — контекст, onDepositCompleted)
- `geo` (GeoFacade)
- NB: `audit` и `notifications` payments-модуль НЕ импортирует

### 6.5. Используется в

- Frontend (создание депозитов/выводов)
- `admin` (approval withdrawals)

### 6.6. Экспортирует

- Ничего (в `payments.module.ts` нет `exports`) — потребители работают через
  собственные контроллеры/use-cases модуля
- NB: `PaymentProvider` — это Prisma-enum из `@casino/database`, а не interface
  модуля; admin читает `payment_requests` напрямую (`PaymentRequestRepository`
  провайдится в `admin.module.ts`)

---

## 7. Casino Module

### 7.1. Ответственность

- Каталог провайдеров (`/casino/providers`)
- Каталог игр (`/casino/games`)
- Фильтрация/поиск игр
- Favorites (избранные игры пользователя)
- Game launch (запуск iframe)
- Demo mode (без авторизации)

### 7.2. Key Use Cases

| UC | Описание |
|----|----------|
| UC-CASINO-01 | Список провайдеров |
| UC-CASINO-02 | Список игр (с фильтрами) |
| UC-CASINO-03 | Детали игры |
| UC-CASINO-04 | Запуск игры (с wallet) |
| UC-CASINO-05 | Запуск demo |
| UC-CASINO-06 | Add/remove favorite |

### 7.3. Использует

- `wallet` (WalletFacade — активный кошелёк при launch; debit/credit в callbacks)
- `auth` (AuthGuard/RolesGuard, в т.ч. на admin-endpoints каталога)
- NB: `casino.module.ts` импортирует также `AdminModule`, но его экспорты
  (AuditLogService/AdminAuth*) внутри модуля не инжектятся

### 7.4. Используется в

- Provider callbacks (bet/win/rollback) приходят на `POST /provider-callback/...` —
  обработка game-sessions живёт в этом же модуле (§8)
- `referrals` (read-only groupBy по `game_transactions` для GGR — ADR GAP-51,
  прямой доступ через общий Prisma-клиент)

---

## 8. Game-Sessions (часть Casino Module)

> Отдельного каталога `modules/game-sessions/` НЕТ: весь код сессий живёт
> внутри `apps/api/src/modules/casino/`. Нумерация секций сохранена исторически.

### 8.1. Ответственность

- Сессия игрока у провайдера (создаётся при каждом launch, `sessionToken` = randomBytes(32).hex)
- URL generation для iframe (через `ProviderAdapterFactory`)
- Обработка provider callbacks (authenticate, balance, bet, win, rollback)

### 8.2. Где лежит

```
apps/api/src/modules/casino/application/services/game-callback.service.ts   (authenticate/balance/bet/win/rollback)
apps/api/src/modules/casino/application/use-cases/launch-game.use-case.ts   (создание сессии)
apps/api/src/modules/casino/presentation/controllers/provider-callback.controller.ts
apps/api/src/modules/casino/infrastructure/repositories/casino.prisma.repository.ts (PrismaGamePlayRepository)
```

### 8.3. Ключевые таблицы

```
game_sessions        (модель GameSession — userId, gameId, currency, status, sessionToken)
game_rounds          (модель GameRound — rounds внутри сессии)
game_transactions    (модель GameTransaction — bet/win/rollback events)
```

### 8.4. Ключевые Use Cases

| UC | Описание |
|----|----------|
| UC-GS-01 | Создать game session (внутри launch-game.use-case) |
| UC-GS-02 | Authenticate provider callback (по sessionToken) |
| UC-GS-03 | Balance callback (возврат текущего баланса) |
| UC-GS-04 | Process bet |
| UC-GS-05 | Process win |
| UC-GS-06 | Process rollback |

NB: refund из протокола провайдера в MVP не реализован (метода в
`GameCallbackService` нет).

### 8.5. Использует

- `wallet` (WalletFacade.credit/debit + WalletFacade.runInTransaction — bet/win/rollback атомарно)
- Таблицы игр/провайдеров того же casino-модуля (GAME_PLAY_REPOSITORY и др.)

### 8.6. Используется в

- Provider callbacks приходят на `POST /provider-callback/:providerSlug/:op`
  (`ProviderCallbackController`)
- `admin` — просмотр сессий/транзакций: `GET /admin/game-sessions`,
  `GET /admin/game-sessions/:id`, `GET /admin/game-transactions`
  (`CasinoAdminController`)

---

## 9. Referrals Module

### 9.1. Ответственность

- Генерация referral code при регистрации
- Привязка referred_by при регистрации с кодом
- Расчёт GGR-share (daily cron)
- Зачисление rewards на баланс реферера

### 9.2. Ключевые таблицы

```
users.referral_code              (unique, 8 chars)
users.referred_by               (FK к users)
referral_rewards                (period, ggr, reward_amount, status)
```

### 9.3. Использует

- `wallet` (WalletFacade.credit для reward)
- `auth` (только AuthGuard; событие USER_REGISTERED не используется — referral
  code и привязка `referred_by` выполняются в самом `register.use-case` /
  `oauth-user-provisioning.service`)
- read-only groupBy по `game_transactions` для расчёта GGR — ADR GAP-51:
  принят прямой доступ через общий Prisma-клиент (`prisma.gameTransaction.groupBy`);
  порт/событие — при выносе casino в отдельный сервис

### 9.4. Используется в

- Frontend (реферальный кабинет)
- `admin` (`ReferralsAdminController` — `POST /admin/referrals/run-daily`, audit-log)
- `maintenance` (job `referral-daily` запускает `ReferralCalcService.runDaily`, §18)

---

## 10. Support Module

### 10.1. Ответственность

- Создание тикетов (subject, category, message)
- Переписка (user ↔ admin)
- Статусы (open, in_progress, waiting_user, closed)
- Internal notes (видны только admin)
- Прикрепление файлов

### 10.2. Ключевые таблицы

```
support_tickets     (user, subject, category, status, priority, assigned)
support_messages    (ticket, sender_type, message, attachments, is_internal)
```

### 10.3. Использует

- Только `auth` (AuthGuard/RolesGuard). NB: `notifications` и `audit`
  support-модуль НЕ импортирует (email при reply в коде не отправляется)

### 10.4. Используется в

- Frontend (user-кабинет)
- Admin-API — `SupportAdminController` живёт в самом support-модуле (пути `admin/support/...`)

---

## 11. Notifications Module

### 11.1. Ответственность

- In-app уведомления (внутренние, таблица notifications)
- Email-канал: проверка user-настройки `notificationsEmail` + постановка
  письма в BullMQ-очередь `email` (отправку делает EmailWorker из queues)
- HTML-шаблоны писем (рендер перед постановкой в очередь)

### 11.2. Ключевые таблицы

```
notifications       (userId, type, channel, title, message, read/unread)
```

Email-джобов отдельной таблицы НЕТ: очередь `email` живёт в BullMQ (Redis) —
`apps/api/src/queues/queue.types.ts`; HTML-шаблоны писем — `apps/api/src/queues/templates/`.

### 11.3. Использует

- `queues` (EMAIL_QUEUE_PORT — постановка email-джоб; отправка — EmailWorker → SMTP-майлер)
- `auth` (AuthGuard/RolesGuard)
- Read-only `user_settings.notificationsEmail` + email пользователя — прямой
  доступ через собственный репозиторий (аналог ADR GAP-51)

### 11.4. Используется в

- Никем: `NotificationsModule` импортируется только в `app.module.ts` (in-app
  API `/notifications` — контроллер самого модуля)
- Письма о событиях (verification, reset, withdrawal-reminder) шлют `auth` и
  `maintenance` напрямую через EMAIL_QUEUE_PORT, минуя notifications-модуль

### 11.5. Экспортирует

- `NotificationService` (send/list/markRead/unreadCount) — но внешних
  потребителей у экспорта сейчас нет

---

## 12. Audit Log (часть Admin Module)

> Отдельного каталога `modules/audit/` НЕТ: audit-log — application-сервис
> внутри admin-модуля. Нумерация секций сохранена исторически.

### 12.1. Ответственность

- Логирование admin actions (manual credit/debit, управление админами,
  admin-auth события)
- Логирование admin-триггеров из других модулей (`ReferralsAdminController` —
  ручной запуск начислений)
- Read-only выдача через `GET /admin/audit-logs`

### 12.2. Где лежит

```
apps/api/src/modules/admin/application/audit-log.service.ts          (AuditLogService.log(input))
apps/api/src/modules/admin/domain/admin.repository.ts                (порт AUDIT_LOG_REPOSITORY)
apps/api/src/modules/admin/infrastructure/repositories/admin.prisma.repository.ts (PrismaAuditLogRepository)
apps/api/src/modules/admin/presentation/controllers/admin-audit.controller.ts
```

### 12.3. Ключевая таблица

```
audit_logs          (actor_type, actor_id, action, target_type, target_id, payload, ip_address, created_at)
```

### 12.4. Используется в

- Контроллеры admin-модуля (`AdminAuditController`, `AdminFinanceController` и др.)
- `referrals` (`ReferralsAdminController` — импортирует `AuditLogService`)
- `maintenance` (job `withdrawal-reminder` пишет трейл напоминаний в
  `audit_logs` напрямую через собственный порт `PrismaReminderAuditRepo`,
  минуя AuditLogService, §18)

### 12.5. Не использует

- Audit-log **никогда** не зависит от других модулей (только пишет в свою таблицу)

---

## 13. Admin Module

### 13.1. Ответственность

- Отдельный admin-JWT auth flow (`AdminAuthService` + `AdminAuthGuard`, таблица admin_users)
- Endpoints для admin-действий (все под `admin/...`):
  - Users list / block / unblock (`AdminUsersController`)
  - Finance: payment requests, withdrawals approval/rejection, manual credit/debit (`AdminFinanceController`)
  - Admin management (`AdminAdminsController`)
  - Audit-logs read-only (`AdminAuditController`, см. §12)
  - Dashboard metrics (`AdminDashboardController`)
  - Settings: контроллер в коде есть (`AdminSettingsController`), но в
    `admin.module.ts` пока не зарегистрирован
- NB: KYC review и referral run-daily админ-API живут в соответствующих
  модулях (`KycAdminController` в kyc, `ReferralsAdminController` в referrals)

### 13.2. Использует

- `wallet` (WalletFacade — manual credit/debit)
- Собственные репозитории к admin_users, audit_logs, dashboard, payment_requests
  (`PaymentRequestRepository` провайдится локально — прямой доступ к таблице payments)
- Экспортирует наружу: `AuditLogService`, `AdminAuthGuard`, `AdminAuthService`

---

## 14. Health Module

### 14.1. Ответственность

- `GET /health` — basic status
- `GET /health/live` — liveness
- `GET /health/ready` — readiness (checks: DB, Redis)

### 14.2. Не использует другие модули

---

## 15. Dependency Graph

Фактические зависимости — по импортам Nest-модулей (сверено с кодом):

```
auth          → queues              (EMAIL_QUEUE_PORT: verification/reset письма)
              (referral code генерируется самим register.use-case; users/
               notifications/referrals auth НЕ импортирует)

users         → auth                (AuthGuard)
              exports UsersFacade, SelfExclusionUseCase

geo           → users               (UsersFacade.getGeoContext)
              (читает exchange_rates — пишет их maintenance, §18)

kyc           → geo                 (GeoFacade.convertRubToDisplay)
              → admin               (AdminAuthGuard для admin-review)
              exports KycCheckService

wallet        → auth                (AuthGuard)
              ↛ NOTHING ELSE        (foundational module)
              exports WalletFacade

payments      → wallet              (WalletFacade.credit/debit/lock)
              → kyc                 (KycCheckService.assertCanDeposit/assertCanWithdraw)
              → users               (UsersFacade)
              → geo                 (GeoFacade)
              exports НИЧЕГО (п.6.6)

casino        → wallet              (WalletFacade: launch + bet/win/rollback)
              → auth                (guards)
              (+ game-sessions — часть этого же модуля, §8)

referrals     → wallet              (WalletFacade.credit для reward)
              → admin               (AuditLogService в referrals-admin)
              (read-only prisma.gameTransaction.groupBy для GGR — ADR GAP-51)

support       → auth                (guards) — больше ничего

notifications → queues              (EMAIL_QUEUE_PORT)
              → auth                (guards)
              (никем не импортируется; письма auth/maintenance шлют напрямую)

admin         → wallet              (WalletFacade — manual credit/debit)
              (+ audit-log — часть admin, §12; собственные репозитории к
               admin_users, audit_logs, dashboard, payment_requests)

health        → (standalone: readiness проверяет db/redis)

maintenance   → referrals           (ReferralCalcService.runDaily — job referral-daily)
              → queues              (BullMQ-очередь `maintenance`: scheduler + worker; EMAIL_QUEUE_PORT)
              → payments            (NOWPaymentsClient — импорт клиента курсов)
              (пишет напрямую: payment_requests, exchange_rates, sessions,
               audit_logs, admin_users — §18)
```

---

## 16. Прочие правила

### 16.1. Разрешённые зависимости

- `presentation` → `application` (внутри модуля)
- `application` → `domain` (внутри модуля)
- `application` → `infrastructure` через DI (внутри модуля)
- `infrastructure` → `domain` (внутри модуля)

### 16.2. Межмодульные зависимости

- Только через **Facade** другого модуля
- Только через **DI** (не импорт напрямую)
- «Facade» на практике = exported Nest-provider модуля: `UsersFacade`,
  `WalletFacade`, `GeoFacade`, а также сервисы-фасады без суффикса
  (`KycCheckService`, `ReferralCalcService`, `AuditLogService`,
  `NotificationService`, `ProviderAdapterFactory`)
- В Nest-DI экспорт модуля регистрирует провайдер, импортирующий модуль инжектит его (отдельного DiContainer-файла в коде нет)

### 16.3. Запрещено

- ❌ Прямой импорт `repository` другого модуля
- ❌ Прямое использование `prisma.user.findUnique()` в `wallet` модуле
- ❌ Использовать `Entity` другого модуля напрямую — только через `Facade` или собственный mapped DTO
- ❌ HTTP-вызовы между модулями (внутри монолита — через DI)

### 16.4. Циклические зависимости

Запрещены. Если возникают — используй:

- Вынести общую логику в общий пакет (`shared-utils`, `shared-types`)
- Ввести промежуточный модуль (`events`)
- Использовать события вместо sync-вызовов

---

## 17. Создание нового модуля

Чеклист:

1. [ ] Прочитать `MODULE_BOUNDARIES.md` (этот файл)
2. [ ] Прочитать `CONVENTIONS.md`
3. [ ] Проверить `packages/shared-types/` на существующие enum/types
4. [ ] Создать структуру:
   ```
   modules/{name}/
   ├── domain/
   ├── application/
   ├── infrastructure/
   ├── presentation/
   ├── {name}.module.ts
   ```
5. [ ] Prisma schema добавить в `packages/database/`
6. [ ] Реализовать Facade для общения извне
7. [ ] Написать unit-тесты
8. [ ] Обновить этот файл — добавить модуль в карту

---

## 18. Maintenance Module

### 18.1. Ответственность

Фоновые обслуживающие задачи (GAP-33, ТЗ ч.3 §13): BullMQ-очередь `maintenance`
(`QUEUES.MAINTENANCE` в `apps/api/src/queues/queue.types.ts`) с repeatable-джобами.
Регистрация — `MaintenanceScheduler` (`apps/api/src/queues/infrastructure/maintenance.scheduler.ts`,
BullMQ Job Schedulers `upsertJobScheduler`), вызывается из
`MaintenanceModule.onApplicationBootstrap`. Интервалы — из env `JOB_*_EVERY_MS`
(дефолты в scheduler; без REDIS_URL / в test — no-op).

| Job (application) | Дефолт | Что делает |
|----|----|----|
| `expire-deposits` | 5 мин | pending-депозиты → `expired`: крипто — по `expires_at` провайдера, фиат — через 2ч после `created_at`; идемпотентен (условный update) |
| `update-rates` | 5 мин | курсы RUB display-валют → `exchange_rates` + Redis-кеш TTL 5 мин: крипто — NOWPayments /estimate (dev-stub без ключа), фиат — константы `DISPLAY_RUB_RATES` из `@casino/shared-config` (source='static') |
| `withdrawal-reminder` | 1 ч | письмо активным админам о выводах в pending >24ч; дедуп 24ч через запись в `audit_logs` (`maintenance.withdrawal_reminder`) |
| `referral-daily` | 24 ч | ежедневный запуск `ReferralCalcService.runDaily` (GGR-share начисления, GAP-32; дедуп внутри) |
| `cleanup-sessions` | 1 ч | удаление мёртвых auth-сессий из `sessions` (expired / отозванные старше grace 7 дней; pre-launch hardening A1) |

### 18.2. Ключевые файлы

```
apps/api/src/modules/maintenance/application/            (5 job-классов: *.job.ts)
apps/api/src/modules/maintenance/domain/maintenance.ports.ts
apps/api/src/modules/maintenance/infrastructure/maintenance.prisma.repo.ts
apps/api/src/modules/maintenance/infrastructure/maintenance.worker.ts
apps/api/src/queues/infrastructure/maintenance.scheduler.ts
apps/api/src/modules/maintenance/maintenance.module.ts
```

### 18.3. Архитектура

- Джобы — application-классы без I/O-зависимостей в конструкторе: БД/письма/курсы —
  через порты из `maintenance.ports.ts` (`PAYMENT_MAINTENANCE_REPO`,
  `SESSION_MAINTENANCE_REPO`, `REMINDER_AUDIT_REPO`, `EXCHANGE_RATE_WRITER`,
  `RATES_PROVIDER`, `MAINTENANCE_EMAIL_PORT`), каждая джоба тестируема in-memory
- `MaintenanceWorker` (infrastructure) — BullMQ Worker очереди `maintenance`,
  диспетчеризация по map `MAINTENANCE_HANDLERS` (job.name → хендлер)
- Дедуп/трейл напоминаний пишутся напрямую в `audit_logs` через
  `PrismaReminderAuditRepo` (AdminModule/AuditLogService не используется)

### 18.4. Использует

- `referrals` (ReferralCalcService — job `referral-daily`)
- `queues` (BullMQ-планирование; EMAIL_QUEUE_PORT — письмо админам)
- `payments` (NOWPaymentsClient — источник курсов; прямой импорт клиента
  из `payments/infrastructure/clients/`)

### 18.5. Используется в

- Никем: самостоятельный cron-слой (регистрируется в `app.module.ts`)

### 18.6. Таблицы (прямой доступ через порты)

```
payment_requests     (listPendingDeposits / listPendingWithdrawals / markExpired)
exchange_rates       (запись курсов + prune истории старше 7 дней)
sessions             (purgeDeadSessions)
audit_logs           (дедуп + трейл напоминаний)
admin_users          (email активных админов)
```

### 18.7. КРИТИЧНО

- Ручной триггер реферальных начислений — `POST /admin/referrals/run-daily`
  (superadmin; audit-log через `AuditLogService`), job `referral-daily` —
  его же автоматический запуск
- Все джобы идемпотентны: повторный тик не создаёт дублей (условные update,
  дедуп-окна, deleteMany по условию)
