---
title: Module Boundaries
description: Границы между модулями backend casino-platform
status: living document
last_updated: 2026-10-03
---

# Module Boundaries

> **Назначение:** Карта модулей, их ответственности, и правил общения. **Прочитать ПЕРЕД созданием нового use case.**

---

## 1. Карта модулей

Фактические каталоги — `apps/api/src/modules/`: **14 модулей** — admin, affiliate,
auth, casino, geo, health, kyc, maintenance, notifications, payments, referrals,
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
│   └──────────────────────────┘ └─────┬─────┘ └─────────┘        │
│                                      │ partner-программа (ТЗ ч.8)│
│   ┌───────────────┐ ┌─────────────────┐ ┌────────┐              │
│   │ notifications │ │ admin (+ audit) │ │affiliate│              │
│   └───────────────┘ └─────────────────┘ └────────┘              │
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

| UC         | Описание                    |
| ---------- | --------------------------- |
| UC-AUTH-01 | Регистрация через email     |
| UC-AUTH-02 | Email verification          |
| UC-AUTH-03 | Login через email           |
| UC-AUTH-04 | Refresh token rotation      |
| UC-AUTH-05 | Logout (invalidate refresh) |
| UC-AUTH-06 | Google OAuth login/register |
| UC-AUTH-07 | Telegram login              |
| UC-AUTH-08 | Forgot password             |
| UC-AUTH-09 | Reset password              |
| UC-AUTH-10 | Change password             |

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
- Публичный API без фасада (решение В6.1): guard'ы аутентификации импортируют
  напрямую из других модулей — это узаконено, а не исключение из правила.
  Фасада у `auth` нет, потому что межмодульного контура, кроме guard'ов, у него
  нет (§16.2). Гард G16 (`tech-debt/cross-module-imports.txt`) такие импорты не
  считает: детектор исключает пути, оканчивающиеся на `.guard` и `.facade`.

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
- `admin` (UsersFacade.blockPlayer/unblockPlayer — блокировка игрока; G24: статус
  `users` и отзыв `sessions` пишет владелец таблиц, а не заказчик)

### 3.5. Экспортирует

- `UsersFacade` (getGeoContext, updateCurrencyPreference, onDepositCompleted, provisionAffiliatePlayer,
  deprovisionAffiliatePlayer, blockPlayer, unblockPlayer) — `users/facade/users.facade.ts`
- Блокировка игрока — порт `USER_STATUS_REPOSITORY` (`domain/repositories/user-status.repository.ts`),
  реализация `PrismaUserStatusRepository`: `blocked` + отзыв живых сессий одной `$transaction`. Метод не
  параметризуется флагом «отзывать сессию или нет»: отзыв — часть блокировки
- `SelfExclusionUseCase` (самоисключение игрока)
- NB: таблица `sessions` общая с auth — чтение/отзыв сессий здесь через `USER_SESSION_REPOSITORY`, выпуск refresh-токенов — в auth (`SESSION_REPOSITORY`)

---

## 3a. Geo Module

### 3a.1. Ответственность

- Geo-конфиг для кассы: legal country, активная валюта, методы оплаты
- Пресеты и лимиты депозита по валюте
- Display-конвертация RUB → активная валюта (KYC UI, без конвертации в player wallet UI)

### 3a.2. Ключевые Use Cases

| UC        | Описание                                             |
| --------- | ---------------------------------------------------- |
| UC-GEO-01 | GET /geo/config — конфиг для гостя / авторизованного |
| UC-GEO-02 | Валидация фиатного метода депозита                   |
| UC-GEO-03 | RUB → display currency (KYC limit_remaining)         |

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

- `PaymentsFacade` (`estimateRub`, `getPaymentRequest`, `updatePaymentStatus`) —
  потребители: `maintenance` (курсы) и `admin` (решение по заявке на вывод)
- NB: `PaymentProvider` — это Prisma-enum из `@casino/database`, а не interface
  модуля. Admin больше не провайдит `PaymentRequestRepository` у себя: доступ к
  заявкам идёт через фасад (G16), а `PAYMENT_REQUEST_REPOSITORY` остаётся
  внутренним портом payments

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

| UC           | Описание                 |
| ------------ | ------------------------ |
| UC-CASINO-01 | Список провайдеров       |
| UC-CASINO-02 | Список игр (с фильтрами) |
| UC-CASINO-03 | Детали игры              |
| UC-CASINO-04 | Запуск игры (с wallet)   |
| UC-CASINO-05 | Запуск demo              |
| UC-CASINO-06 | Add/remove favorite      |

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

| UC       | Описание                                           |
| -------- | -------------------------------------------------- |
| UC-GS-01 | Создать game session (внутри launch-game.use-case) |
| UC-GS-02 | Authenticate provider callback (по sessionToken)   |
| UC-GS-03 | Balance callback (возврат текущего баланса)        |
| UC-GS-04 | Process bet                                        |
| UC-GS-05 | Process win                                        |
| UC-GS-06 | Process rollback                                   |

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
- `admin` (admin-API `ReferralsAdminController` — `GET /admin/referrals`,
  `GET /admin/referrals/stats`; ручной триггер `POST /admin/referrals/run-daily`
  переехал в maintenance presentation, §18 — решение В2, путь/контракт сохранены)
- `maintenance` (job `referral-daily` и ручной триггер зовут
  `ReferralsFacade.runDaily` — фасад referrals, решение В1; §18)

---

## 9a. Affiliate Module (партнёрская программа, ТЗ ч.8)

### 9a.1 Ответственность

- Регистрация/вход партнёров (affiliate) — внешних вебмастеров
- Трекинг кликов по ссылке `/go/{tracking_code}` + cookie-атрибуция
- Привязка игрока к партнёру при регистрации + антифрод F1–F3
- Квалификация атрибуции (депозит ≥ порога + KYC)
- Расчёт NGR и RevShare, начисление комиссии на кошелёк партнёра
- Clawback начислений при самоисключении игрока (ответственная игра)
- Admin-API: партнёры, индивидуальные ставки, начисления, настройки программы

**НЕ путать с §9 referrals:** `referrals` — программа «приведи друга» для
игроков (GGR, общая ставка из env). `affiliate` — внешние вебмастеры,
индивидуальная ставка, расчёт от **NGR**, своя сущность и свой кабинет.

### 9a.2 Ключевые таблицы

```
affiliates              (partner: userId, email, tracking_code, revshare_rate, status)
affiliate_clicks        (клик: affiliateId, landing_path, ip_hash — только хеш)
affiliate_attributions  (привязка: playerId UNIQUE, status, reject_reason)
affiliate_commissions   (начисление: ngr_amount, revshare_rate-снимок, commission_amount)
system_settings         (affiliate_* — настройки программы, включая ставку по умолчанию)
```

### 9a.3 Использует

- `wallet` (WalletFacade.credit/debit — единственный способ зачислить/списать комиссию)
- `admin` (AuditLogService — аудит смены ставки/статуса/настроек)
- `auth` (RolesGuard на admin-эндпоинтах; AuthModule — из-за цикла см. §15)
- `users` (ТОЛЬКО порт `RESPONSIBLE_GAMING_HOOK` — clawback; см. §9a.5)
- read-only `game_transactions` / `ledger_entries` / `kyc_profiles` / `users`
  через порты репозиториев (ADR GAP-51, согласован с referrals)

### 9a.4 Используется в

- `auth` (привязка игрока к партнёру при регистрации)
- `maintenance` (джобы `affiliate-daily`, `affiliate-qualification`,
  `affiliate-clicks-cleanup`)
- `admin`-API (контроллер живёт в affiliate-модуле, пути `admin/affiliate/...`)

### 9a.5 КРИТИЧНО

- **Наружу экспортируется только `AffiliateFacade`** (+ JwtService/Guard для
  своих контроллеров). Остальные use cases — внутренние.
- **Цикл модулей auth ↔ affiliate разорван через `ModuleRef`:** affiliate
  импортирует AuthModule (нужны RolesGuard), поэтому auth не может импортировать
  affiliate. Привязка игрока вызывается из `RegisterUseCase` через
  `ModuleRef.get(AffiliateFacade, { strict: false })` — ленивое разрешение без
  статической зависимости. **Прямой импорт affiliate в auth сломает сборку.**
- **Деньги — только через WalletFacade**, ledger type = `CONVERSION_CREDIT`,
  idempotencyKey = `aff_{commissionId}` (кредит) / `aff_clawback_{id}` (дебет).
- **IP не хранится в открытом виде** — только SHA-256(ip + INTERNAL_API_SECRET).
  Хеш обязан считаться тем же `IpHasher` (DI-токен с `useExisting`), иначе
  антифрод-правила F1/F3 молча перестанут срабатывать.
- **Ставка не применяется задним числом:** начисление хранит снимок
  `revshare_rate`; смена ставки действует со следующего периода.
- **Идемпотентность расчёта** обеспечена уникальным индексом
  `(affiliate_id, player_id, period_start, currency)`.

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

- `admin` (`NotificationsFacade.broadcastInternal`) — массовая рассылка. До
  2026-10-04 её писал сам admin: `prisma.notification.createMany` из своего
  репозитория (гард G24). Формат уведомления — `channel`, default `data`,
  правило `isRead` — теперь задаёт один модуль, а не два
- Письма о событиях (verification, reset, withdrawal-reminder) шлют `auth` и
  `maintenance` напрямую через EMAIL_QUEUE_PORT, минуя notifications-модуль
- Больше `NotificationsModule` нигде не импортируется; in-app API
  `/notifications` — контроллер самого модуля

### 11.5. Экспортирует

- `NotificationsFacade` (`notifications/facade/notifications.facade.ts`) —
  `broadcastInternal(rows): Promise<number>`, единственная точка входа для
  чужих модулей (правило 4). Возвращает число вставленных строк: вызывающий
  отдаёт оператору факт из БД, а не длину своего списка адресатов
- `NotificationService` (send/list/markRead/unreadCount) — экспорт оставлен как
  был, внешних потребителей у него нет

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
  - Settings (`AdminSettingsController`) и рассылка (`AdminNotificationsController`) —
    оба зарегистрированы в `admin.module.ts` (#135 закрыл 404 на `/admin/settings` и
    `/admin/notifications/send`, держит `admin-module-wiring`)
- NB: KYC review и referral run-daily админ-API живут в соответствующих
  модулях (`KycAdminController` в kyc, `ReferralsAdminController` в referrals)

### 13.2. Использует

- `wallet` (WalletFacade — manual credit/debit)
- `users` (`UsersFacade.blockPlayer/unblockPlayer`) — блокировка игрока. Админ заказывает
  действие, а `user.status` и `session.revokedAt` пишет владелец таблиц: раньше эти три записи
  делал `admin.prisma.repository` (G24)
- `notifications` (`NotificationsFacade.broadcastInternal`) — массовая рассылка
- `payments` (`PaymentsFacade` — approve/reject заявки на вывод; узкий токен
  `WITHDRAWAL_REQUEST_STORE` закрывается адаптером в `admin/infrastructure`,
  порты и Prisma-класс payments наружу не импортируются — G16)
- Собственные репозитории к admin_users, audit_logs, dashboard.
  Список заявок (`payment_requests`) контроллер пока читает через `prisma`
  напрямую — это долг В3 (presentation → БД), а не G16: таблица в этом
  обращении не пишется

### 13.2.1. Публичный API (наружу из `AdminModule`, exports)

- `AdminFacade` (`admin/facade/admin.facade.ts`) — **санкционированный путь** для
  записи аудита из других модулей: `logAction(input)` оборачивает
  `AuditLogService.log` и не роняет операцию при сбое журнала. Потребители:
  `affiliate` (affiliate-admin), `maintenance` (ручной триггер run-daily).
- `AdminFacade.logActionStrict(input)` — тот же контракт, но сбой летит наружу.
  Нужен вызывающим, для которых строка `audit_logs` является состоянием, а не
  только наблюдакостью: `maintenance.withdrawal_reminder` служит ключом дедупа,
  и молчаливый пропуск записи означал бы второе письмо админу через час
  (потребитель — `maintenance`, G24).
- `AdminAuthModule` (`admin/admin-auth.module.ts`) — провайдер и экспортер
  `AdminAuthGuard` + `AdminAuthService`. Вынесен из `AdminModule` не для красоты:
  `KycModule` импортировал весь `AdminModule` ради одного guard'а, и любая
  попытка убрать deep-импорты admin собирала цикл
  `admin → payments → kyc → admin` (payments нужен kyc для порога депозитов),
  который eslint ловит статически по `import/no-cycle`. Теперь kyc импортирует
  только вход в админку.
- `AdminAuthGuard` (`admin/presentation/admin-auth.guard`) — публичный API по
  решению **В6.1** (guards аутентификации = exports модуля, §16.2). Импортируют
  напрямую: `kyc` (`KycAdminController`), `affiliate` (`AffiliateAdminController`).
  Отдельного фасада под guard нет: guard — это middleware-контракт, а не
  бизнес-операция. Наружу он идёт через `AdminModule → exports: [AdminAuthModule]`
  (переэкспорт модуля): Nest не позволяет экспортировать провайдер чужого модуля
  напрямую, и падает на старте контейнера, а не на typecheck.
- `AdminAuthService` — рядом с guard'ом потому, что `AdminAuthGuard` инжектит
  его: без переэкспорта DI в потребителях не резолвится (E2E, PR #15).
- `AuditLogService` — **legacy-экспорт**: исторически его импортировал
  `MaintenanceAdminController` напрямую (долг был заморожен в
  `tech-debt/cross-module-imports.txt`). После В1/В6 maintenance перешёл на
  `AdminFacade.logAction`, и сервис из exports можно убрать в PR, который трогает
  `admin/**` (сейчас не удалён — `admin.module.ts` вне объёма этой задачи;
  удаление надо проверять на E2E с БД, а не только на typecheck).

⚠️ Гард G16 (`tech-debt/cross-module-imports`) **не считает** импорты,
оканчивающиеся на `.guard` и `.facade`, — то есть `AdminAuthGuard` и все фасады
формально «невидимы» для детектора. Легальность этих межмодульных импортов
обеспечивает этот раздел (§13.2.1) и §16.2, а не гард.

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
              exports PaymentsFacade (estimate, чтение заявки, смена статуса)

casino        → wallet              (WalletFacade: launch + bet/win/rollback)
              → auth                (guards)
              (+ game-sessions — часть этого же модуля, §8)

referrals     → wallet              (WalletFacade.credit для reward)
              → admin               (AuditLogService в referrals-admin)
              (read-only prisma.gameTransaction.groupBy для GGR — ADR GAP-51)

affiliate     → wallet              (WalletFacade.credit/debit — комиссия и clawback)
              → admin               (AuditLogService в affiliate-admin)
              → auth                (RolesGuard на admin-эндпоинтах)
              → users               (порт RESPONSIBLE_GAMING_HOOK; реализацию
                                     поставляет affiliate — зависимость через
                                     порт односторонняя, цикла нет)
              (read-only game_transactions/ledger_entries/kyc_profiles/users
               через порты — ADR GAP-51)

auth          ↛ affiliate           (цикл разорван: привязка через ModuleRef,
                                     см. §9a.5. ПРЯМОЙ ИМПОРТ ЗАПРЕЩЁН)

support       → auth                (guards) — больше ничего

notifications → queues              (EMAIL_QUEUE_PORT)
              → auth                (guards)
              (никем не импортируется; письма auth/maintenance шлют напрямую)

admin         → wallet              (WalletFacade — manual credit/debit)
              (+ audit-log — часть admin, §12; собственные репозитории к
               admin_users, audit_logs, dashboard, payment_requests)

health        → (standalone: readiness проверяет db/redis)

maintenance   → referrals           (ReferralsFacade.runDaily — job referral-daily)
              → admin               (AdminFacade.logAction — аудит ручного run-daily)
              → affiliate           (AffiliateFacade.runDaily + 3 affiliate-джоба)
              → queues              (BullMQ-очередь `maintenance`: scheduler + worker; EMAIL_QUEUE_PORT)
              → payments            (PaymentsFacade — estimateRub для курсов и
                                    expirePendingPayment для `expire-deposits`)
              → users               (UsersFacade.purgeDeadSessions — `cleanup-sessions`)
              (пишет напрямую только exchange_rates — это ЕГО таблица по MODEL_OWNERS;
               чужие записи ушли фасадам владельцев, G24 и §18.3)
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
  (`KycCheckService`, `AuditLogService`, `NotificationService`,
  `ProviderAdapterFactory`)
- В Nest-DI экспорт модуля регистрирует провайдер, импортирующий модуль инжектит его (отдельного DiContainer-файла в коде нет)

**Сколько фасадов нужно модулю (решение В1, 2026-10):** фасад обязателен модулю,
который **потребляется извне**, а не «один фасад на каждый модуль». Критерий —
греп по импортам `modules/<mod>/{domain,application,infrastructure,presentation,facade}/`
из чужих модулей: есть потребитель → фасад нужен; нет → фасада нет, и это не
нарушение. Так из 14 модулей фасады есть у 8 (`admin`, `affiliate`, `geo`, `kyc`,
`payments`, `referrals`, `users`, `wallet`), а `casino`/`health`/`maintenance`/
`notifications`/`support` не импортирует никто — заводить там файл-формальность
значит получить 5 лишних мест дрейфа при нулевой выгоде по ограничениям.
`auth` — частный случай: его дёргают извне только ради guard'ов, а guard'ы и есть
его публичный API (В6.1), поэтому фасада у него нет.

**Публичный API без фасада — guard'ы аутентификации (решение В6.1):**
`AuthGuard`/`RolesGuard` (§2.5), `AdminAuthGuard` (§13.2.1),
`AffiliateAuthGuard` (§9a) — узаконенные межмодульные импорты. Гард G16
(`tech-debt/cross-module-imports.txt`) исключает пути, оканчивающиеся на
`.guard` и `.facade`, поэтому такие импорты в долг не попадают **и не
проверяются автоматически** — они легализованы именно этим текстом, а не
«молча» остаются серой зоной.

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
6. [ ] Реализовать Facade для общения извне — **только если модуль кто-то
       импортирует** (правило §16.2, решение В1); модуль без внешних потребителей
       фасада не имеет
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

| Job (application)          | Дефолт | Что делает                                                                                                                                                                                               |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expire-deposits`          | 5 мин  | pending-депозиты → `expired`: крипто — по `expires_at` провайдера, фиат — через 2ч после `created_at`; идемпотентен (условный update)                                                                    |
| `update-rates`             | 5 мин  | курсы RUB display-валют → `exchange_rates` + Redis-кеш TTL 5 мин: крипто — NOWPayments /estimate (dev-stub без ключа), фиат — константы `DISPLAY_RUB_RATES` из `@casino/shared-config` (source='static') |
| `withdrawal-reminder`      | 1 ч    | письмо активным админам о выводах в pending >24ч; дедуп 24ч через запись в `audit_logs` (`maintenance.withdrawal_reminder`)                                                                              |
| `referral-daily`           | 24 ч   | ежедневный запуск `ReferralCalcService.runDaily` (GGR-share начисления, GAP-32; дедуп внутри)                                                                                                            |
| `cleanup-sessions`         | 1 ч    | удаление мёртвых auth-сессий из `sessions` (expired / отозванные старше grace 7 дней; pre-launch hardening A1)                                                                                           |
| `affiliate-daily`          | 24 ч   | суточный расчёт RevShare партнёрам от NGR (`AffiliateFacade.runDaily`, ТЗ ч.8 §15; дедуп уникальным индексом)                                                                                            |
| `affiliate-qualification`  | 1 ч    | квалификация `pending` → `qualified` (депозит ≥ порога + KYC); ловит гонку «депозит раньше KYC»                                                                                                          |
| `affiliate-clicks-cleanup` | 24 ч   | удаление кликов старше `affiliate_click_retention_days` (атрибуции переживают: ON DELETE SET NULL)                                                                                                       |

### 18.2. Ключевые файлы

```
apps/api/src/modules/maintenance/application/            (5 job-классов: *.job.ts)
apps/api/src/modules/maintenance/domain/maintenance.ports.ts
apps/api/src/modules/maintenance/infrastructure/maintenance.prisma.repo.ts
apps/api/src/modules/maintenance/infrastructure/maintenance.worker.ts
apps/api/src/modules/maintenance/presentation/maintenance-admin.controller.ts
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
- Дедуп/трейл напоминаний пишет admin: `PrismaReminderAuditRepo` заказывает строку
  через `AdminFacade.logActionStrict` (G24, 2026-10-04). Раньше запись шла напрямую в
  `audit_logs`. Строгий вариант фасада, а не best-effort `logAction`, выбран потому, что
  эта строка — ключ дедупа: молчаливый пропуск записи означал бы второе письмо админу
  через час, а падение видно в логе джобы
- Истечение заявок (`pending → expired`) заказывается через
  `PaymentsFacade.expirePendingPayment`, уборка сессий — через
  `UsersFacade.purgeDeadSessions`. Условие «только pending» и OR-фильтр мёртвых строк
  уехали вместе с записями к владельцам таблиц, иначе гарантию гонки нельзя было бы
  сохранить на чужой стороне границы
- Чтения чужих таблиц (`payment_requests`, `audit_logs`, `admin_users`) остались
  прямыми через prisma: межмодульное чтение разрешено ADR GAP-51, детектор записей
  (`tech-debt/foreign-writes.txt`) их не считает

### 18.4. Использует

- `referrals` (ReferralsFacade.runDaily — job `referral-daily` и ручной триггер;
  В1: до фасада тянули `ReferralCalcService` из `referrals/application/`)
- `admin` (AdminFacade.logAction — audit-log ручного триггера run-daily; В6:
  до этого — прямой импорт `AuditLogService`)
- `queues` (BullMQ-планирование; EMAIL_QUEUE_PORT — письмо админам)
- `payments` (NOWPaymentsClient — источник курсов; прямой импорт клиента
  из `payments/infrastructure/clients/`)
- `auth` (AuthGuard/RolesGuard — на presentation-контроллере ручного триггера)

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
  (`MaintenanceAdminController`, presentation maintenance; решение В2 — переехал
  из referrals-модуля, путь/guards/контракт сохранены; superadmin; audit-log
  через `AdminFacade.logAction`), job `referral-daily` — его же автоматический запуск
- Все джобы идемпотентны: повторный тик не создаёт дублей (условные update,
  дедуп-окна, deleteMany по условию)
