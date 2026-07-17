---
title: "Online Casino Platform — Technical Specification"
description: "Полное ТЗ онлайн-казино платформы на стеке NestJS + Next.js + Prisma + PostgreSQL + Redis"
status: "ready for implementation"
stack: ["NestJS", "TypeScript", "Prisma", "PostgreSQL", "Redis", "BullMQ", "Next.js", "Tailwind"]
created: "2026-06-19"
total_parts: 7
---

# Online Casino Platform — Technical Specification

> **Полное ТЗ для построения онлайн-казино платформы** с нуля до продакшн-деплоя.
> Стек: **NestJS** + **TypeScript** + **Prisma** + **PostgreSQL** + **Redis** + **BullMQ** + **Next.js** + **Tailwind**.
> Рынок: **СНГ**, русский язык, фиат через **Rukassa**, крипто через **NOWPayments**.

---

## 📚 Содержание ТЗ

| # | Часть | Файл | Описание |
|---|------|------|---------|
| 1 | **Foundation** | [tz-part-1-foundation.md](./tz-part-1-foundation.md) | Архитектура monorepo, стек, соглашения, структура пакетов, Prisma schema (все таблицы), общие правила |
| 2 | **Backend Core** | [tz-part-2-auth-users-kyc-rbac.md](./tz-part-2-auth-users-kyc-rbac.md) | Auth (email/Google/Telegram), Users, KYC по лимиту 5000₽, RBAC (user/admin/superadmin), audit_logs, email queue |
| 3 | **Wallet & Payments** | [tz-part-3-payments-wallet.md](./tz-part-3-payments-wallet.md) | Мультивалютный кошелёк, ledger с optimistic locking, Rukassa (фиат), NOWPayments (крипто), выводы, конвертация |
| 4 | **Casino Providers** | [tz-part-4-casino-providers.md](./tz-part-4-casino-providers.md) | Seamless Wallet API, 22 use cases, Provider Adapter Layer, каталог игр, DemoProvider для разработки |
| 5 | **Frontend Web** | [tz-part-5-frontend-web.md](./tz-part-5-frontend-web.md) | Next.js витрина, каталог игр, ЛК, кошелёк, KYC, поддержка, реферальный кабинет |
| 6 | **Admin Panel** | [tz-part-6-admin-support-referrals.md](./tz-part-6-admin-support-referrals.md) | Admin-панель, тикеты поддержки, реферальная система (GGR-share), уведомления |
| 7 | **DevOps & Release** | [tz-part-7-devops-security-qa.md](./tz-part-7-devops-security-qa.md) | VPS, Docker, Nginx, SSL, CI/CD, логирование, безопасность, QA, чеклист запуска |

---

## 📂 Документация для AI-агента и разработчика

Полная **структурированная документация** в папке [`docs/`](./docs/):

| Документ | Назначение |
|----------|------------|
| 📖 [INDEX.md](./docs/INDEX.md) | Навигация по всей документации (начните отсюда) |
| 🚨 [**AI_DEVELOPMENT_RULES.md**](./docs/AI_DEVELOPMENT_RULES.md) | **ОБЯЗАТЕЛЬНО ПЕРВЫМ ДЕЛОМ** — 13 критичных правил для AI |
| 🏛️ [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Архитектурные решения (Modular Monolith, слои) |
| 📚 [STACK.md](./docs/STACK.md) | Обоснование выбора каждой технологии |
| 📐 [API_CONVENTIONS.md](./docs/API_CONVENTIONS.md) | Стандарты REST API (URL, status codes, errors) |
| ✍️ [CONVENTIONS.md](./docs/CONVENTIONS.md) | Code conventions (TypeScript, naming, money) |
| 🧩 [MODULE_BOUNDARIES.md](./docs/MODULE_BOUNDARIES.md) | Ответственности модулей и зависимости |
| 🔐 [SECURITY_BASELINE.md](./docs/SECURITY_BASELINE.md) | Безопасность на всех уровнях |
| 💳 [PAYMENT_OVERVIEW.md](./docs/PAYMENT_OVERVIEW.md) | Платежи, идемпотентность, webhook'и |
| 🎮 [PROVIDER_INTEGRATION_STRATEGY.md](./docs/PROVIDER_INTEGRATION_STRATEGY.md) | Game-провайдеры, Seamless Wallet API |
| ⚙️ [ENVIRONMENT_VARIABLES.md](./docs/ENVIRONMENT_VARIABLES.md) | Все env-переменные с дефолтами и валидацией |

---

## 🏗️ Архитектура платформы (high-level)

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
└─────────────┬──────────────────────────────────┬─────────────────┘
              │                                  │
              │ HTTPS                            │ HTTPS
              ▼                                  ▼
       ┌──────────────────┐             ┌────────────────────┐
       │   Web            │             │   Admin Panel      │
       │   Next.js 14     │             │   Next.js 14       │
       │   apps/web       │             │   apps/admin       │
       │   Port: 3000     │             │   Port: 3002       │
       │   casino.example │             │   admin.example    │
       └────────┬─────────┘             └─────────┬──────────┘
                │                                 │
                │  /api/v1/*                      │  /api/v1/admin/*
                ▼                                 ▼
       ┌──────────────────────────────────────────────────┐
       │                    Nginx (SSL, rate limiting)    │
       └─────────────────┬────────────────────────────────┘
                         ▼
       ┌──────────────────────────────────────────────────┐
       │   API (NestJS) — apps/api — Port: 3001          │
       │                                                  │
       │   modules/                                       │
       │   ├── auth/                                      │
       │   ├── users/                                     │
       │   ├── kyc/                                       │
       │   ├── wallet/                                    │
       │   ├── payments/                                  │
       │   ├── casino/                                    │
       │   ├── support/                                   │
       │   ├── referrals/                                 │
       │   ├── notifications/                             │
       │   └── admin/                                     │
       └─────┬─────────────┬───────────┬──────────────────┘
             │             │           │
             ▼             ▼           ▼
       ┌─────────┐   ┌─────────┐  ┌──────────────────────────┐
       │Postgres │   │  Redis  │  │  BullMQ Workers          │
       │  16     │   │   7     │  │  ├── email               │
       │         │   │         │  │  ├── notifications       │
       └─────────┘   └─────────┘  │  ├── exchange-rates      │
                                   │  ├── expire-payments     │
                                   │  └── referral-rewards    │
                                   └──────────────────────────┘
```

### Внешние интеграции

```
┌────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Rukassa      │  │  NOWPayments    │  │   Google OAuth  │
│   (фиат: RUB,  │  │  (крипто:       │  │                 │
│    СБП, P2P)   │  │   USDT/BTC/     │  └─────────────────┘
└────────────────┘  │   TON/TRX/LTC)  │  ┌─────────────────┐
                    └─────────────────┘  │   Telegram      │
┌────────────────┐                       │   Login Widget  │
│  Resend SMTP   │  ┌─────────────────┐  │                 │
│  (email queue) │  │  Game Providers │  └─────────────────┘
└────────────────┘  │  (Pragmatic,    │
                    │   Evolution,    │
                    │   BGaming)      │
                    └─────────────────┘
```

---

## 📊 Карта модулей (cross-reference)

### Backend модули (NestJS)

| Модуль | Часть ТЗ | Ключевые use cases | Основные таблицы |
|--------|---------|-------------------|-----------------|
| **auth** | 2 | UC-AUTH-01..09 (register, login, OAuth, sessions) | `users`, `auth_providers`, `sessions`, `email_verifications`, `password_resets` |
| **users** | 2 | UC-USER-01..06 (profile, settings, avatar, sessions) | `user_profiles`, `user_settings` |
| **kyc** | 2 | UC-KYC-01..07 (submit, documents, review) | `kyc_profiles`, `kyc_documents` |
| **admin** | 2, 6 | Admin auth, users list, KYC review, audit | `admin_users`, `audit_logs` |
| **wallet** | 3 | UC-WALLET-01..08 (balances, credit/debit/lock/unlock) | `wallet_accounts`, `ledger_entries` |
| **payments** | 3 | UC-PAY-01..18 (deposit/withdrawal, fiat/crypto) | `payment_requests`, `payment_callbacks`, `exchange_rates` |
| **casino** | 4 | Seamless Wallet API, каталог, launch, favorites | `game_providers`, `games`, `game_sessions`, `game_rounds`, `game_transactions`, `game_favorites` |
| **support** | 6 | UC-SUPPORT-01..12 (tickets, messages, internal notes) | `support_tickets`, `support_messages` |
| **referrals** | 6 | UC-REF-01..08 (GGR-share, daily cron) | `referral_rewards` |
| **notifications** | 6 | UC-NOTIF-01..05 (email + internal) | `notifications` |
| **email-worker** | 2 | BullMQ queue `email`, 5+ шаблонов | — |
| **health** | 7 | UC-HEALTH-01..02 | — |

### Frontend приложения (Next.js)

| App | Часть ТЗ | Разделы |
|-----|---------|---------|
| **apps/web** | 5 | `/`, `/casino`, `/casino/[slug]`, `/profile`, `/wallet`, `/wallet/transactions`, `/wallet/deposit`, `/wallet/withdraw`, `/history`, `/kyc`, `/support`, `/referral`, `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` |
| **apps/admin** | 6 | `/login`, `/` (dashboard), `/users`, `/users/[id]`, `/transactions`, `/payments`, `/payments/[id]`, `/withdrawals`, `/kyc`, `/kyc/[id]`, `/games`, `/providers`, `/providers/[id]`, `/support`, `/support/[id]`, `/referrals`, `/audit`, `/admins`, `/settings` |

---

## 🎯 Ключевые архитектурные решения

### Деньги

> ⚠️ **КРИТИЧНО:** ВСЕГДА `DECIMAL(20,8)` в БД, `decimal.js` в коде, **string** в API. **НИКОГДА** `number`/`float`.

### Кошелёк (Wallet)

- Поддержка валют: `RUB`, `USDT_TRC20`, `BTC`, `TON`, `TRX`, `LTC`
- `wallet_accounts.balance` — кэшируемый баланс
- `wallet_accounts.locked` — заблокированные средства (при выводе)
- `available = balance - locked`
- **Optimistic locking** через поле `version` с retry до 3 раз
- Всегда внутри `prisma.$transaction()`
- Ledger append-only (`ledger_entries`)

### Idempotency

- Каждая финансовая операция имеет уникальный `idempotency_key`
- Дубликаты определяются по ключу → вернуть результат предыдущей операции
- Формат ключей по конвенциям части 3

### KYC

- **Лимит 5000 ₽ суммарных пополнений** без KYC
- Хранится RUB-эквивалент для крипто-депозитов
- Вывод **всегда требует KYC** (любая сумма)
- Статусы: `not_started` → `pending` → `approved` | `rejected` | `requires_resubmission`

### Game Providers

- **Seamless Wallet API** — единая интеграция любого провайдера
- Callback-и: `authenticate`, `balance`, `bet`, `win`, `rollback`, `refund`
- Каждый провайдер реализует `GameProviderAdapter`
- На MVP: только `DemoProvider` для разработки

### RBAC

- 3 роли: `user`, `admin`, `superadmin`
- Проверка прав в **Guard**, не в Service
- Все admin-действия → `audit_logs`

---

## 🔐 Безопасность (top-level чеклист)

```
✅ Пароли — argon2id (memory cost 65536, time cost 3, parallelism 4)
✅ JWT — RS256 или HS256 с длинным секретом (>= 64 символа)
✅ Refresh tokens — хранить ТОЛЬКО hash в БД, ротация при каждом использовании
✅ Reset/verify токены — crypto.randomBytes(64), короткий TTL
✅ Rate limiting — на auth/webhook endpoints через Nginx + ThrottlerModule
✅ CORS — только свои домены
✅ Helmet + security headers в Nginx
✅ UFW + fail2ban на VPS
✅ Все webhook-и верифицируют подпись
✅ KYC документы хранятся вне публичной директории
✅ .env файлы в .gitignore, secrets в GitHub Secrets
```

---

## ⏱️ Оценка сроков разработки

| Этап | Недели | Содержание |
|------|-------|-----------|
| **Этап 1** | 1-2 | Foundation: monorepo, БД, shared packages, Docker dev setup |
| **Этап 2** | 2-3 | Auth backend (email, Google, Telegram), Users, KYC, RBAC |
| **Этап 3** | 3-4 | Wallet core + Ledger, Rukassa интеграция, NOWPayments интеграция |
| **Этап 4** | 4-5 | Casino providers, Seamless Wallet API, DemoProvider |
| **Этап 5** | 5-7 | Frontend Web полностью (все страницы + UI-kit + Stores) |
| **Этап 6** | 7-9 | Admin Panel, Support, Referrals, Notifications |
| **Этап 7** | 9-10 | DevOps настройка VPS, деплой, тестирование, Release |
| **Итого** | **~10 недель** | MVP готов к запуску |

---

## 🤖 Гайд по работе с ТЗ для AI-агента

### При старте сессии агент ДОЛЖЕН прочитать

**Обязательный bootstrap (в этом порядке):**

1. 🚨 [docs/AI_DEVELOPMENT_RULES.md](./docs/AI_DEVELOPMENT_RULES.md) — **критичные правила первым делом**
2. 📖 [docs/INDEX.md](./docs/INDEX.md) — навигация по документации
3. 🏛️ **Этот README.md** — общая картина проекта
4. 🏛️ [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — архитектурные решения
5. 📚 [docs/STACK.md](./docs/STACK.md) — технологии
6. ✍️ [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) и [docs/API_CONVENTIONS.md](./docs/API_CONVENTIONS.md)
7. 🧩 [docs/MODULE_BOUNDARIES.md](./docs/MODULE_BOUNDARIES.md)
8. 🔐 [docs/SECURITY_BASELINE.md](./docs/SECURITY_BASELINE.md)
9. Соответствующая **часть ТЗ** (`tz-part-N-*.md`)
10. `packages/database/prisma/schema.prisma`

**Если работаем с Payments/Casino** — дополнительно:
- [docs/PAYMENT_OVERVIEW.md](./docs/PAYMENT_OVERVIEW.md)
- [docs/PROVIDER_INTEGRATION_STRATEGY.md](./docs/PROVIDER_INTEGRATION_STRATEGY.md)

### Порядок подачи частей AI-агенту

```
Тип 1: Foundation (Часть 1)
─────────────────────────────────────────────────
Сессия 1:  Создать monorepo + pnpm workspaces, .gitignore, env.example
Сессия 2:  Prisma schema (ВСЕ таблицы из всех частей)
Сессия 3:  Shared packages: shared-types, shared-utils, shared-config
Сессия 4:  Docker Compose dev (postgres + redis)
Сессия 5:  ESLint, Prettier, Husky, Commitlint
Сессия 6:  Создать apps/api, apps/web, apps/admin скелеты

Тип 2: По одной части за раз
─────────────────────────────────────────────────
Каждая часть состоит из 3-10 блоков (А, Б, В, ...)
Реализовать блок за блоком в правильном порядке.
Не делать несколько блоков из разных частей одновременно.
```

### Правила форматирования задач для агента

```typescript
// Пример хорошего промпта:

"Реализуй Блок А. Auth Module из Части 2 ТЗ (tz-part-2-auth-users-kyc-rbac.md).

Сначала прочитай:
- README.md (этот файл)
- docs/ARCHITECTIONS.md
- docs/CONVENTIONS.md
- packages/database/prisma/schema.prisma

Затем реализуй структуру модуля auth по слоям:
- domain/ (User entity, AuthProvider entity, Session entity)
- application/use-cases/ (RegisterUseCase, LoginUseCase, ...)
- infrastructure/repositories/ (UserRepository, AuthProviderRepository, ...)
- infrastructure/services/ (PasswordHasher, JwtService, EmailQueueService)
- presentation/controllers/ (AuthController)
- presentation/dto/ (RegisterDto, LoginDto, ...)

Use cases:
- UC-AUTH-01: Регистрация через email
- UC-AUTH-02: Подтверждение email
- UC-AUTH-03: Вход через email
- UC-AUTH-04: Refresh token
- UC-AUTH-05: Logout

Критерий приёмки: см. Часть 2.

После реализации:
1. Напиши unit тесты для AuthService (vitest)
2. Запусти pnpm typecheck
3. Запусти pnpm lint
4. Сделай code review через code-reviewer"
```

---

## 📋 Чеклист готовности к запуску

Полный чеклист — в [Часть 7, раздел 15](./tz-part-7-devops-security-qa.md#15-release-preparation-checklist).

Сокращённый top-level:

```
Инфраструктура:
  [ ] VPS настроен (Hetzner CX41)
  [ ] UFW, fail2ban, SSH key auth
  [ ] SSL сертификаты (Let's Encrypt)
  [ ] Docker + Docker Compose
  [ ] Nginx reverse proxy

Backend:
  [ ] Все миграции применены
  [ ] Seed admin создан
  [ ] Health endpoints отвечают 200
  [ ] Backup script работает

Безопасность:
  [ ] Все secrets сгенерированы
  [ ] .env в .gitignore
  [ ] JWT secrets >= 64 символа
  [ ] Rate limiting включён

Интеграции:
  [ ] Rukassa sandbox депозит работает
  [ ] NOWPayments тестовый депозит работает
  [ ] Google OAuth callback настроен
  [ ] Telegram bot работает
  [ ] SMTP отправляет тестовое письмо

Frontend:
  [ ] apps/web загружается
  [ ] apps/admin загружается
  [ ] Registration + login E2E работают
  [ ] Каталог игр отображается
  [ ] Demo игра запускается

Юридическое:
  [ ] Условия использования
  [ ] Политика конфиденциальности
  [ ] Ответственная игра
  [ ] 18+ предупреждение
```

---

## 📞 Поддержка ТЗ

Если найдены несостыковки между частями — обновлять затронутые части синхронно.

Каждая часть имеет в frontmatter номер и `total_parts: 7` — это помогает AI-агенту понимать, где он находится в общем плане.

Все части записаны как **отдельные markdown файлы** для удобной выдачи AI-агенту по одной.

---

> **🚀 Готово к реализации.** Передавай агенту часть за частью в порядке 1 → 7, и через ~10 недель будет готов MVP.
