---
title: Module Boundaries
description: Границы между модулями backend casino-platform
status: living document
last_updated: 2026-06-19
---

# Module Boundaries

> **Назначение:** Карта модулей, их ответственности, и правил общения. **Прочитать ПЕРЕД созданием нового use case.**

---

## 1. Карта модулей

```
┌──────────────────────────────────────────────────────────────┐
│                        Backend                                │
│                                                               │
│   ┌─────┐  ┌──────┐  ┌─────┐  ┌─────────┐  ┌──────────┐     │
│   │auth │  │users │  │ kyc │  │  wallet │  │ payments │     │
│   └──┬──┘  └──┬───┘  └──┬──┘  └────┬────┘  └─────┬────┘     │
│      │        │        │          │             │            │
│      ▼        ▼        ▼          ▼             ▼            │
│   ┌─────┐                ┌──────────┐  ┌──────────────────┐ │
│   │audit│                │ referrals│  │     casino       │ │
│   └─────┘                └──────────┘  │  + game-sessions │ │
│                                        └──────────────────┘ │
│   ┌───────────┐  ┌──────────────────┐                       │
│   │ support   │  │  notifications   │                       │
│   └───────────┘  └──────────────────┘                       │
│                                                               │
│   ┌────────┐  ┌──────┐                                       │
│   │ health │  │ admin│                                       │
│   └────────┘  └──────┘                                       │
└──────────────────────────────────────────────────────────────┘
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

### 2.3. Использует

- `users` (создание User entity)
- `notifications` (отправка verification email)
- `referrals` (генерация referral code + привязка)

### 2.4. Используется в

- `users` (для контекста текущего пользователя)
- ВСЕ модули (для RequireAuth guard)

### 2.5. Экспортирует

- `AuthFacade` — login/register используется извне
- `JwtAuthGuard`, `OptionalJwtAuthGuard` — NestJS providers
- `CurrentUser` decorator

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

- Все модули должны знать о User (id, email, status)

### 3.5. Экспортирует

- `UserFacade` (findById, findByEmail)
- `UserEntity` (read-only DTO для других модулей)

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

- `users` (для user context)
- `notifications` (уведомление о смене статуса)
- `audit` (логирует KYC status changes)

### 4.4. Используется в

- `payments` (проверка лимита при deposit)
- `payments` (блокировка withdraw без approved)
- `admin` (KYC review)

### 4.5. Экспортирует

- `KycFacade` — `isVerified(userId)`, `getStatus(userId)`, `checkDepositLimit(userId, amount)`

---

## 5. Wallet Module

### 5.1. Ответственность

- Кошельки по валютам (1 user × N currencies)
- Operations: credit, debit, lock, unlock, confirmWithdrawal
- Optimistic locking через `version` field
- Ledger (append-only) для всех операций
- Currency conversion (через exchange_rates)

### 5.2. Ключевые таблицы

```
wallet_accounts      (userId × currency — balance, locked, version)
ledger_entries       (append-only — каждая операция)
exchange_rates       (RUB ↔ crypto курсы, обновляются cron)
```

### 5.3. Использует

- `users` (проверка user существует)

### 5.4. Используется в

- `payments` (credit при deposit, debit при withdrawal)
- `casino` (debit при bet, credit при win, rollback)
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
RukassaAdapter       — фиат (RUB через карты, СБП, P2P)
NowPaymentsAdapter   — крипто (USDT/BTC/TON/TRX/LTC)
ManualAdapter        — admin manual credit (через admin endpoint)
```

### 6.3. Ключевые таблицы

```
payment_requests     (все платежи — статус, провайдер, externalId)
payment_callbacks    (raw callbacks от провайдеров)
```

### 6.4. Использует

- `wallet` (credit/debit при confirm payments)
- `kyc` (проверка лимитов и статуса)
- `users` (контекст пользователя)
- `audit` (логирует все payment events)

### 6.5. Используется в

- Frontend (создание депозитов/выводов)
- `admin` (approval withdrawals)

### 6.6. Экспортирует

- `PaymentsFacade` — `createDeposit`, `createWithdrawal`, `getStatus`
- `PaymentProvider` interface (для admin testing)

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

- `wallet` (определение активного кошелька пользователя)

### 7.4. Используется в

- `game-sessions` (сессии создаются на каждый launch)

---

## 8. Game-Sessions Module

### 8.1. Ответственность

- Безаутентификационная сессия с провайдером
- URL generation для iframe
- Обработка provider callbacks (authenticate, balance, bet, win, rollback, refund)

### 8.2. Ключевые таблицы

```
game_sessions        (active sessions — userId, gameId, currency, openedAt)
game_rounds          (отдельные rounds внутри сессии)
game_transactions    (bet/win/rollback events)
```

### 8.3. Ключевые Use Cases

| UC | Описание |
|----|----------|
| UC-GS-01 | Создать game session |
| UC-GS-02 | Authenticate provider callback |
| UC-GS-03 | Balance callback (возврат текущего баланса) |
| UC-GS-04 | Process bet |
| UC-GS-05 | Process win |
| UC-GS-06 | Process rollback |
| UC-GS-07 | Process refund |
| UC-GS-08 | Close session |

### 8.4. Использует

- `wallet` (credit/debit при win/bet/rollback через WalletFacade)
- `casino` (получить game config)

### 8.5. Используется в

- Provider callbacks приходят на `POST /provider-callback/...`
- `admin` (просмотр сессий)

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

- `wallet` (credit для reward)
- `auth` (получает событие USER_REGISTERED для привязки)
- `casino` (event из game_transactions для расчёта GGR)

### 9.4. Используется в

- Frontend (реферальный кабинет)
- `admin` (статистика)

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

- `notifications` (email при reply)
- `audit` (admin actions)

### 10.4. Используется в

- Frontend (user-кабинет)
- `admin` (admin context)

---

## 11. Notifications Module

### 11.1. Ответственность

- Email queue (BullMQ)
- Internal notifications (in-app)
- Шаблоны для всех типов
- User notification preferences

### 11.2. Ключевые таблицы

```
notifications       (userId, type, channel, title, message, read/unread)
email_jobs          (BullMQ internal)
```

### 11.3. Использует

- SMTP provider (отправка email)

### 11.4. Используется в

- `auth` (verification emails)
- `users` (profile updates)
- `payments` (deposit/withdrawal status)
- `kyc` (status changes)
- `support` (reply notifications)
- `referrals` (reward notifications)

### 11.5. Экспортирует

- `NotificationsFacade.send({userId, type, channel, title, message, data})`

---

## 12. Audit Module

### 12.1. Ответственность

- Логирование всех admin actions
- Логирование критичных user actions (block, kyc approve)
- Read-only через admin endpoints

### 12.2. Ключевая таблица

```
audit_logs          (actor_id, actor_type, action, entity_type, entity_id, data, created_at)
```

### 12.3. Используется в

- ВСЕ модули логируют через `AuditLogService.log(...)`

### 12.4. Не использует

- Audit **никогда** не зависит от других модулей (только пишет в свою таблицу)

---

## 13. Admin Module

### 13.1. Ответственность

- Отдельный JWT auth flow
- Endpoints для admin-действий:
  - Users list / block / unblock
  - KYC review
  - Withdrawal approval/rejection
  - Manual wallet credit/debit
  - Dashboard metrics
  - Settings

### 13.2. Использует

- Все остальные модули через их Facade и Use Cases

---

## 14. Health Module

### 14.1. Ответственность

- `GET /health` — basic liveness
- `GET /health/details` — internals (DB, Redis, queues)

### 14.2. Не использует другие модули

---

## 15. Dependency Graph

```
auth          → users (create user)
              → notifications (verification email)
              → referrals (generate code, link referrer)

users         → (standalone, базовые операции)

kyc           → users
              → notifications
              → audit

wallet        → users               (UserFacade.findById)
              ↛ NOTHING ELSE       (это foundational module)

payments      → wallet              (WalletFacade)
              → kyc                 (KycFacade.checkLimit / isVerified)
              → users               (UserFacade)
              → audit
              → notifications

casino        → wallet              (get active currency balance)
              → (read-only таблицы игр/провайдеров)

game-sessions → wallet              (credit/debit при win/bet/rollback)
              → casino              (game config)

referrals     → wallet              (credit для reward)
              → casino              (event game_transaction для GGR)
              → notifications       (email reward notification)

support       → notifications       (notify admin/user)
              → audit

notifications → (standalone — SMTP provider)

audit         → (standalone — пишет в свою таблицу)

admin         → ВСЕ модули через их Facade

health        → (standalone)
```

---

## 16. Прые правила

### 16.1. Разрешённые зависимости

- `presentation` → `application` (внутри модуля)
- `application` → `domain` (внутри модуля)
- `application` → `infrastructure` через DI (внутри модуля)
- `infrastructure` → `domain` (внутри модуля)

### 16.2. Межмодульные зависимости

- Только через **Facade** другого модуля
- Только через **DI** (не импорт напрямую)
- В DiContainer одна module регистрирует свой Facade как Provider, другие модули его импортируют

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
