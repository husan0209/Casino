---
title: Architecture
description: High-level архитектурные решения и обоснования для casino-platform
audience: AI-agents, разработчики
status: living document
last_updated: 2026-06-19
---

# Architecture

> **Назначение:** Дать полную картину архитектурных решений платформы и обоснование каждого выбора.
>
> Документ описывает **ЧТО** и **ПОЧЕМУ**. Подробности реализации — в соответствующих TZ частях.

---

## Содержание

1. [Архитектурный стиль](#1-архитектурный-стиль)
2. [Границы системы](#2-границы-системы)
3. [Высокоуровневая диаграмма](#3-высокоуровневая-диаграмма)
4. [Backend: модульная структура](#4-backend-модульная-структура)
5. [Слои внутри модуля](#5-слои-внутри-модуля)
6. [Общение между модулями](#6-общение-между-модулями)
7. [Frontend структура](#7-frontend-структура)
8. [Данные и хранение](#8-данные-и-хранение)
9. [Реалтайм и очереди](#9-реалтайм-и-очереди)
10. [Аутентификация и доступ](#10-аутентификация-и-доступ)
11. [Эволюция архитектуры](#11-эволюция-архитектуры)
12. [Технический долг и ограничения](#12-технический-долг-и-ограничения)

---

## 1. Архитектурный стиль

### 1.1. Решение: Modular Monolith

Платформа — единое NestJS-приложение, разбитое на логически изолированные модули. Никаких микросервисов на MVP.

```
┌────────────────────────────────────────────────────────┐
│                  NestJS App Process                   │
│                                                       │
│   modules/auth    modules/wallet   modules/payments  │
│   modules/users   modules/kyc      modules/casino     │
│   modules/support modules/notifications ...           │
│                                                       │
│   ─── один process, один runtime, одна БД ───         │
└────────────────────────────────────────────────────────┘
```

### 1.2. Почему именно Modular Monolith

| Фактор | Решение |
|--------|---------|
| Над проектом работает AI-агент + владелец | Микросервисы слишком сложны для одиночной разработки |
| Деплой на 1 VPS | Намного проще, чем оркестрация нескольких сервисов |
| Единая кодовая база типов | Prisma client + shared-types без проблем с versioning |
| Простая отладка платежей и KYC | Один stack trace, одна транзакция БД |
| Логика сильно связна (wallet ↔ payments ↔ casino) | Микросервисы добавили бы сетевые race conditions без выгоды |

### 1.3. Архитектурные влияния

Используем смесь:

- **DDD-lite** — модули как домены, чёткая зона ответственности, но без полного bounded context
- **Clean Architecture** — слоистая структура внутри модуля (domain → application → infrastructure → presentation)
- **NestJS module system** — DI-контейнер и модули из коробки
- **Use-case oriented** — бизнес-логика только в `application/use-cases/`, не в контроллерах

---

## 2. Границы системы

### 2.1. Что входит в MVP

| Домен | Описание |
|-------|----------|
| **Auth** | Email/Google/Telegram login, refresh token rotation, sessions |
| **Users** | Профиль, настройки, аватар, сессии |
| **KYC** | Лимит 5000₽ без KYC, документы, статусы |
| **Wallet** | Мультивалютный, ledger, optimistic locking |
| **Payments** | Фиат (Rukassa) + крипто (NOWPayments), webhook |
| **Casino Providers** | Seamless Wallet API, DemoProvider |
| **Support** | Тикеты, переписка, internal notes |
| **Referrals** | GGR-share, daily cron, статистика |
| **Notifications** | Email-очередь, внутренние уведомления |
| **Admin Panel** | Dashboard, users, KYC review, withdrawals, audit |
| **Audit Logs** | Все admin-действия и критичные события |

### 2.2. Что НЕ входит в MVP

- Sportsbook, бонусы, VIP, cashback
- In-house games (только внешние провайдеры)
- Anti-fraud ML
- Мобильные приложения (только PWA)
- Многоязычность (только ru)
- Multi-tenant
- Микросервисы

---

## 3. Высокоуровневая диаграмма

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser (PWA)                         │
└─────────────┬──────────────────────────────┬────────────────┘
              │                              │
              ▼ HTTPS                        ▼ HTTPS
   ┌──────────────────────┐        ┌──────────────────────────┐
   │  Web (Next.js 14)    │        │  Admin (Next.js 14)      │
   │  casino.example.com  │        │  admin.example.com       │
   │  port: 3000          │        │  port: 3002              │
   └──────────┬────────────┘        └──────────┬───────────────┘
              │ /api/v1/*                     │ /api/v1/admin/*
              ▼                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │          Nginx (SSL termination, rate limiting)         │
   └──────────────────────────┬───────────────────────────────┘
                              ▼
   ┌──────────────────────────────────────────────────────────┐
   │         API (NestJS 11) — port: 3001                    │
   │                                                          │
   │   /api/v1/auth            /api/v1/wallet/balances       │
   │   /api/v1/users/me        /api/v1/payments/deposit      │
   │   /api/v1/casino/games    /api/v1/casino/games/:id/...  │
   │   /api/v1/support/...     /api/v1/referrals/...         │
   │   /api/v1/admin/...       /api/v1/provider-callback/... │
   │                                                          │
   │   modules/ (12 доменов)                                 │
   └────┬──────────┬────────────┬─────────────────┬──────────┘
        │          │            │                 │
        ▼          ▼            ▼                 ▼
   ┌────────┐ ┌─────────┐ ┌─────────────┐ ┌──────────────────┐
   │ Postgres│ │ Redis 7 │ │ BullMQ      │ │ External         │
   │  16     │ │         │ │ Workers     │ │ Integrations     │
   │         │ │         │ │             │ │                  │
   │(основная│ │(cache,  │ │ email       │ │ Rukassa          │
   │ БД)     │ │ throttl.│ │ notif       │ │ NOWPayments      │
   │         │ │ locks)  │ │ exchange    │ │ Google OAuth     │
   │         │ │         │ │ expire      │ │ Telegram Login   │
   │         │ │         │ │ referrals   │ │ Game providers   │
   └────────┘ └─────────┘ └─────────────┘ └──────────────────┘
```

---

## 4. Backend: модульная структура

### 4.1. Список модулей

```
apps/api/src/modules/
├── auth/              — Регистрация, вход, OAuth, refresh
├── users/             — Профиль, settings, avatar
├── kyc/               — KYC формы, документы, статусы
├── wallet/            — Кошельки, ledger, lock/unlock
├── payments/          — Депозиты, выводы, provider adapters
├── casino/            — Catalog, providers, favorites
├── game-sessions/     — GameSession aggregate
├── support/           — Тикеты, сообщения
├── referrals/         — GGR share, rewards
├── notifications/     — Email + internal notifications
├── admin/             — Admin endpoints, dashboard
├── audit/             — Audit logs API
└── health/            — Health checks
```

### 4.2. Гранулярность модулей

| Решение | Обоснование |
|---------|-------------|
| **Отдельный модуль `game-sessions` отдельно от `casino`** | Casino — каталог игр (read-only), game-sessions — runtime state |
| **`wallet` отдельно от `payments`** | Wallet — внутренний ledger, payments — внешние провайдеры |
| **`kyc` отдельно от `users`** | KYC имеет свою жизненный цикл и workflows |
| **`audit` отдельный модуль** | Используется из всех модулей через facade |

---

## 5. Слои внутри модуля

Каждый модуль имеет **предсказуемую 4-слойную структуру**:

```
module-name/
├── domain/                      ← чистая бизнес-логика
│   ├── entities/                ← User, Wallet, GameSession
│   ├── value-objects/           ← Money, Currency, EmailAddress
│   ├── enums/                   ← UserStatus, KycStatus
│   ├── errors/                  ← InsufficientFundsError, KycRequiredError
│   └── repositories/            ← IUserRepository (интерфейс)
│
├── application/                 ← use cases / orchestration
│   ├── use-cases/               ← RegisterUser, CreditWallet, ProcessWebhook
│   ├── services/                ← сложные use cases могут быть в service
│   ├── dto/                     ← input/output контракты use cases
│   ├── events/                  ← DomainEvent definitions
│   └── validators/              ← Zod schemas для input
│
├── infrastructure/              ← внешний мир
│   ├── repositories/            ← PrismaUserRepository (имплементация)
│   ├── clients/                 ← HttpClient, RedisClient
│   ├── adapters/                ← RukassaAdapter, NowPaymentsAdapter
│   ├── mappers/                 ← database row → domain entity
│   └── queue/                   ← BullMQ producers/consumers
│
├── presentation/                ← HTTP граница
│   ├── controllers/             ← REST endpoints
│   ├── dtos/                    ← Request/Response DTO (с декораторами class-validator)
│   ├── guards/                  ← JwtAuthGuard, RolesGuard
│   └── interceptors/            ← ResponseFormatInterceptor
│
└── module-name.module.ts        ← NestJS module wiring
```

### 5.1. Правила зависимостей

**Разрешено:**

```
presentation  → application
application   → domain
application   → infrastructure (только через DI/интерфейсы)
infrastructure → domain
domain        → ничего
```

**Запрещено:**

```
presentation → infrastructure (прямой доступ)
presentation → domain (прямой доступ к entity)
domain       → всё остальное
mодуль A     → внутренности модуля B (только через facade)
```

### 5.2. Зачем нужны слои

- **Тестируемость**: use cases можно тестировать с mock-репозиторием
- **Замена инфраструктуры**: переход с Prisma на другой ORM не затрагивает use cases
- **Параллельная разработка**: разные слои могут писаться разными людьми
- **AI-friendly**: каждый слой имеет предсказуемое место для кода

---

## 6. Общение между модулями

### 6.1. Синхронное взаимодействие (фасады)

Модуль A нуждается в функциональности модуля B → импортирует **фасад** модуля B:

```typescript
// modules/wallet/application/wallet.facade.ts
@Injectable()
export class WalletFacade {
  constructor(
    private creditUseCase: CreditWalletUseCase,
    private debitUseCase: DebitWalletUseCase,
  ) {}

  async creditForDeposit(input: CreditInput): Promise<CreditResult> {
    return this.creditUseCase.execute({
      ...input,
      idempotencyKey: `deposit_${input.paymentRequestId}`,
      type: 'DEPOSIT',
    })
  }
}
```

```typescript
// modules/payments/application/use-cases/confirm-deposit.use-case.ts
@Injectable()
export class ConfirmDepositUseCase {
  constructor(
    private walletFacade: WalletFacade,  // ← из другого модуля, но через фасад
  ) {}

  async execute(input: ConfirmDepositInput) {
    return this.walletFacade.creditForDeposit({
      userId: input.userId,
      currency: input.currency,
      amount: input.amount,
      paymentRequestId: input.paymentRequestId,
    })
  }
}
```

### 6.2. Асинхронное взаимодействие (events + BullMQ)

Для слабосвязанных сценариев — domain events и BullMQ workers:

```
┌──────────────────────────────────────────────────────────────┐
│  Event Bus (in-process EventEmitter)                          │
│                                                               │
│  events/                                                      │
│  ├── USER_REGISTERED     → startWelcomeBonusJob              │
│  ├── DEPOSIT_COMPLETED   → checkKycLimit, sendNotification    │
│  ├── KYC_APPROVED        → sendNotification, liftLimits       │
│  ├── WITHDRAWAL_REQUESTED → notifyAdmin, holdFunds            │
│  ├── BET_PLACED          → accumulateGgr, checkFraudPattern   │
│  ├── REFERRAL_GGR_CALC   → dailyRewardJob (BullMQ cron)      │
└──────────────────────────────────────────────────────────────┘
```

### 6.3. Когда что использовать

| Сценарий | Подход |
|----------|--------|
| Wallet.credit нужен сразу в payment confirm | **Sync через WalletFacade** |
| После успешного депозита отправить email | **Async через BullMQ** |
| KYC approved → снять лимиты | **Sync через KycFacade** |
| Каждый день считать GGR рефералам | **Async BullMQ cron** |

### 6.4. Запрещено

- Модуль A напрямую вызывает `prisma.walletAccount.update()` из модуля B
- Модуль A импортирует `repository` другого модуля
- Модуль A использует HTTP-вызов к модулю B (внутри монолита — всегда через DI)
- Циклические зависимости между модулями

---

## 7. Frontend структура

```
apps/web/                     apps/admin/
├── app/                      ├── app/
│   ├── (auth)/               │   ├── login/
│   │   ├── login/            │   └── (dashboard)/
│   │   └── register/         │       ├── users/
│   ├── (main)/               │       ├── kyc/
│   │   ├── casino/           │       └── ...
│   │   ├── profile/          
│   │   ├── wallet/           
│   │   └── kyc/              
├── components/              
│   ├── ui/                   (shadcn/ui-подобный набор)
│   ├── layout/               
│   ├── auth/                 
│   └── casino/               
├── hooks/                    
├── stores/                   (Zustand)
└── lib/                      (api client, utils)
```

Особенности:

- **apps/web** — публичный сайт для игроков
- **apps/admin** — внутренняя панель для операторов
- **Shared**: `packages/shared-types`, `packages/shared-utils`
- **API Client**: автоматический refresh token через Axios interceptor

---

## 8. Данные и хранение

### 8.1. PostgreSQL — единственная primary

```
Primary DB          → PostgreSQL 16 (Prisma ORM)
Cache + queues      → Redis 7
Файлы (KYC, support) → локальная FS /app/uploads (вне public)
Логи                → /app/logs (JSON, daily rotation)
Backups             → /home/deploy/backups/*.sql.gz (7 days retention)
```

### 8.2. Главные дизайн-решения

| Решение | Где |
|---------|-----|
| **Все деньги — DECIMAL(20,8)** | `wallet_accounts`, `ledger_entries`, `payment_requests` |
| **Все FK с индексами** | Все user_id, status, created_at поля |
| **Append-only ledger** | `ledger_entries` НИКОГДА не update/delete |
| **Raw webhook storage** | `payment_callbacks` хранит ВСЁ до обработки |
| **Idempotency key** | Уникальный constraint на каждой финансовой таблице |

### 8.3. Почему НЕ MongoDB / НЕ DynamoDB

- Реляционные данные (user ↔ wallet ↔ transactions ↔ audit)
- ACID-транзакции критичны для денег
- Один primary store проще администрировать на VPS

---

## 9. Реалтайм и очереди

### 9.1. На MVP — НЕТ WebSocket

Все обновления через Polling:
- Баланс обновляется при возврате на страницу / каждые 30 секунд
- Уведомления polling при открытии / фокусе окна
- Статус платежа polling каждые 10 секунд в модалке депозита

WebSocket добавляется **только если** появится реальная потребность (live bets ticker, real-time уведомления поддержки).

### 9.2. BullMQ Workers

```
┌──────────────────────────────────────────┐
│ BullMQ Queues                             │
│                                           │
│ ├── email               (SMTP отправка)  │
│ ├── notifications       (internal + push)│
│ ├── exchange-rates      (обновление курсов)
│ ├── expire-payments     (cron 1min)      │
│ ├── referral-rewards    (cron daily 02:00)│
│ ├── kyc-reminders       (cron daily)     │
│ └── provider-sync       (manual trigger) │
└──────────────────────────────────────────┘
```

Все jobs:
- идемпотентны (можно повторно запустить);
- логируют start/success/failure;
- имеют retry с exponential backoff;
- лимит на attempts (обычно 3-5).

---

## 10. Аутентификация и доступ

### 10.1. User flow

```
         Register          Login         Refresh         Logout
            │                │              │                │
            ▼                ▼              ▼                ▼
   POST /auth/register  POST /auth/login POST /auth/refresh POST /auth/logout
            │                │              │                │
            ▼                ▼              ▼                ▼
       {access,        {access,        {access,        invalidate
        refresh}        refresh}        refresh}       refresh_token
                          │              │
                          ▼              ▼
                    set cookies     rotate refresh
                    (httpOnly)      (новый в БД,
                                    старый удалён)
```

### 10.2. Admin flow

Отдельный endpoint `/admin/auth/login`:
- Своя JWT с `role: 'admin' | 'superadmin'`
- Отдельные cookies/сессии (не пересекаются с user)
- Admin JWT имеет `aud: 'admin'`, user JWT имеет `aud: 'user'`

### 10.3. Guards

| Guard | Применяется к |
|-------|---------------|
| `JwtAuthGuard` | Любой авторизованный |
| `OptionalJwtAuthGuard` | Endpoints с разным поведением для guest/auth |
| `RolesGuard(['admin'])` | Admin endpoints |
| `RolesGuard(['superadmin'])` | Superadmin endpoints |
| `KycRequiredGuard` | Withdraw, high-value deposit |
| `EmailVerifiedGuard` | Sensitive operations |
| `InternalApiGuard` | Provider callbacks |

---

## 11. Эволюция архитектуры

### 11.1. Фазы

| Фаза | Что выносим |
|------|-------------|
| **MVP (текущая)** | Modular monolith |
| **Фаза 2** | Вынести `notifications` worker в отдельный процесс |
| **Фаза 3** | Вынести `provider-callback` в отдельный API |
| **Фаза 4** | Вынести `payments` в отдельный микросервис (если появится 3+ провайдера) |
| **Фаза 5** | Realtime gateway отдельным сервисом |

### 11.2. Что НЕ меняется

- Структура `domain/application/infrastructure/presentation` слоёв
- Prisma + PostgreSQL как источник истины
- Use case API остаётся стабильным для web/admin клиентов

### 11.3. Что МОЖЕТ меняться

- Где физически работает код (отдельный сервис / всё в одном)
- Как мы общаемся между сервисами (HTTP/RabbitMQ/Kafka)
- Количество реплик каждого процесса

---

## 12. Технический долг и ограничения

### 12.1. Известные ограничения MVP

| Ограничение | Влияние | Когда решать |
|-------------|---------|--------------|
| Один VPS | Если ляжет — всё недоступно | На фазу 2 — multi-VPS |
| Polling вместо WS | UX чуть хуже | На фазу 5 — WebSocket |
| Manual user segmentation | Не удобно для маркетинга | На фазу 3 |
| Нет A/B testing | Не тестируем гипотезы | На фазу 4 |

### 12.2. Архитектурные риски

| Риск | Митигация |
|------|-----------|
| Рост модулей до 20+ | Дробление по доменам, вынос в отдельные сервисы |
| Provider callback flood | BullMQ + rate limit + queue depth alert |
| DB становится узким местом | Реплики, connection pooling, partition по дате |
| Tight coupling к Prisma | Repository pattern → можно мигрировать |
| Race conditions в wallet | Optimistic locking + retry loop |

---

> **Главное правило:** архитектура проектируется так, чтобы **следующий AI-агент мог продолжить работу без потери контекста**. Это делает модульность, документацию и предсказуемость приоритетами.
