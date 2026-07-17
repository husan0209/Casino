# ТЗ — Часть 1. Общая архитектура и Foundation

> Документ описывает технический фундамент проекта (casino-platform). Бизнес-логика казино, платежей и провайдеров в этой части **не раскрывается** — только foundation.
>
> Всего ТЗ разбито на **7 частей**:
>
> 1. **Общая архитектура и foundation** ← текущая часть
> 2. **Backend Core: Auth, Users, KYC, RBAC**
> 3. **Wallet, Fiat/Crypto Payments, Transaction Ledger**
> 4. **Casino Providers и Game Session Layer**
> 5. **Frontend Web: витрина, личный кабинет, кошелёк, история**
> 6. **Admin Panel, Support, Referral System**
> 7. **DevOps, Security, Logging, QA, Release Prep**
>
> Когда будешь готов — напиши **«продолжай»**, и я сгенерирую **Часть 2**.

---

## Содержание

1. [Цель этапа](#1-цель-этапа)
2. [Архитектурное решение](#2-архитектурное-решение)
3. [Выбранный стек](#3-выбранный-стек)
4. [Границы MVP на уровне архитектуры](#4-границы-mvp-на-уровне-архитектуры)
5. [Структура репозитория](#5-структура-репозитория)
6. [Модульная структура backend](#6-модульная-структура-backend)
7. [Стандарты проектирования](#7-стандарты-проектирования)
8. [Стандарты API](#8-стандарты-api)
9. [Работа с деньгами и числами](#9-работа-с-деньгами-и-числами)
10. [Конфигурация окружений](#10-конфигурация-окружений)
11. [Аутентификация и доступ](#11-аутентификация-и-доступ)
12. [Базовая структура базы данных](#12-базовая-структура-базы-данных)
13. [Redis и очереди](#13-redis-и-очереди)
14. [Логирование и observability](#14-логирование-и-observability)
15. [Документация внутри проекта](#15-документация-внутри-проекта)
16. [Правила для AI-разработки](#16-правила-для-ai-разработки)
17. [Базовые нефункциональные требования](#17-базовые-нефункциональные-требования)
18. [Технические задачи этапа](#18-технические-задачи-этапа)
19. [Итоговые артефакты](#19-итоговые-артефакты-по-часть-1)
20. [Что НЕ надо делать в Части 1](#20-что-не-надо-делать-в-части-1)

---

## 1. Цель этапа

На этом этапе нужно создать **технический фундамент проекта**, на котором дальше AI-агент сможет последовательно собирать все остальные модули без сильной путаницы.

Эта часть **не включает** полноценную бизнес-логику казино, платежей и провайдеров.
Она включает:

- выбор и фиксацию архитектурного подхода;
- создание monorepo;
- настройку backend/web/admin приложений;
- общие пакеты;
- общие стандарты API;
- базовую схему модулей;
- инфраструктуру локальной и VPS-разработки;
- базовые технические правила для AI-разработки.

---

## 2. Архитектурное решение

### 2.1. Выбранный подход

Для проекта выбрать архитектуру:

**Modular Monolith**

То есть:

- один backend как основное API-приложение;
- отдельное web-приложение;
- отдельное admin-приложение;
- отдельный websocket/realtime слой можно вынести позже, но на MVP допустимо держать внутри backend;
- модули изолированы логически, но работают в одном runtime.

### 2.2. Почему именно это решение

Причины выбора:

- проект будет разрабатываться **одним AI-агентом + тобой**;
- нет постоянного живого code review;
- микросервисы на старте слишком сложны;
- modular monolith проще деплоить на VPS;
- легче поддерживать единые типы, единый database client и единый auth-контекст;
- проще отлаживать платежи, кошелёк, историю ставок и KYC.

### 2.3. Эволюция архитектуры в будущем

Система должна быть спроектирована так, чтобы позже можно было вынести в отдельные сервисы:

- payment processing
- provider integration layer
- realtime gateway
- admin/reporting
- notifications

Но в MVP это **не выносится**.

---

## 3. Выбранный стек

### 3.1. Backend

- **Node.js LTS**
- **TypeScript**
- **NestJS**
- **Prisma ORM**
- **PostgreSQL**
- **Redis**
- **BullMQ**
- **Zod**
- **Passport/JWT**
- **argon2** для хеширования паролей

**Почему NestJS**
NestJS лучше подходит для AI-разработки, потому что:

- модульная структура;
- понятные dependency boundaries;
- стандартные patterns;
- много готовых best practices;
- проще держать единообразный код по всему проекту.

### 3.2. Frontend

- **Next.js**
- **TypeScript**
- **Tailwind CSS**
- **React Query / TanStack Query**
- **Zustand** для локального состояния
- **React Hook Form + Zod**

### 3.3. Admin Panel

- **Next.js**
- **TypeScript**
- **Tailwind CSS**
- компонентный UI-kit на базе shadcn/ui или аналогичной структуры

### 3.4. DevOps / Infra

На старте:

- **Docker**
- **Docker Compose**
- **Nginx**
- **Ubuntu VPS**
- **GitHub**
- **GitHub Actions** для CI
- **PM2 не использовать**, если есть Docker
- SSL через **Let's Encrypt**
- object storage пока можно не вводить, либо использовать S3-совместимое хранилище позже

---

## 4. Границы MVP на уровне архитектуры

### 4.1. Что входит в MVP

На уровне системы должны быть предусмотрены следующие домены:

- Auth
- Users
- KYC
- Wallet
- Payments
- Casino Providers
- Game Sessions
- Transaction History
- Personal Cabinet
- Admin Panel
- Support
- Referral System
- Notifications
- Audit Logs

### 4.2. Что не входит в MVP

На первом этапе не делать:

- sportsbook;
- бонусную систему;
- VIP систему;
- cashback;
- in-house игры;
- полноценный anti-fraud ML;
- мобильные приложения;
- многоязычность;
- multi-tenant;
- отдельные микросервисы.

---

## 5. Структура репозитория

### 5.1. Формат репозитория

Использовать **monorepo**.

Рекомендуемая структура:

```bash
casino-platform/
  apps/
    api/
    web/
    admin/
  packages/
    shared-types/
    shared-config/
    shared-utils/
    database/
    eslint-config/
    tsconfig/
  docs/
  infra/
  scripts/
```

### 5.2. Назначение приложений

#### `apps/api`

Основной backend:

- REST API
- auth
- wallet
- kyc
- providers
- admin api
- support api
- referral api

#### `apps/web`

Публичная пользовательская часть:

- главная
- каталог игр
- профиль
- кошелёк
- история
- support
- referral cabinet

#### `apps/admin`

Внутренняя админка:

- пользователи
- транзакции
- kyc
- поддержка
- провайдеры
- audit logs
- referrals

### 5.3. Общие пакеты

#### `packages/shared-types`

Общие DTO, enum, response models, domain types.

#### `packages/shared-config`

Конфигурация env, app config loaders, feature flags.

#### `packages/shared-utils`

Утилиты:

- money helpers
- date helpers
- crypto helpers
- pagination helpers
- error builders

#### `packages/database`

Prisma schema, migrations, prisma client wrapper, seed scripts.

#### `packages/eslint-config`

Общий линтер.

#### `packages/tsconfig`

Общие tsconfig пресеты.

---

## 6. Модульная структура backend

### 6.1. Backend должен быть разбит на модули

В `apps/api/src/modules` создать доменные модули:

```bash
modules/
  auth/
  users/
  kyc/
  wallet/
  payments/
  casino/
  game-sessions/
  support/
  referrals/
  notifications/
  admin/
  audit/
  health/
```

### 6.2. Внутренняя структура каждого модуля

Каждый модуль должен иметь предсказуемую структуру:

```bash
module-name/
  application/
  domain/
  infrastructure/
  presentation/
  module-name.module.ts
```

#### Назначение слоёв

**`domain/`** — содержит:

- сущности;
- value objects;
- интерфейсы репозиториев;
- доменные правила;
- доменные ошибки.

**`application/`** — содержит:

- use cases;
- service orchestration;
- DTO;
- command/query handlers;
- validators.

**`infrastructure/`** — содержит:

- Prisma repositories;
- provider clients;
- external SDK wrappers;
- queue producers/consumers;
- mappers.

**`presentation/`** — содержит:

- controllers;
- request/response DTO adapters;
- guards;
- interceptors;
- route bindings.

---

## 7. Стандарты проектирования

### 7.1. Основной архитектурный стиль

Использовать смесь:

- **DDD-lite**
- **Clean Architecture principles**
- **NestJS module boundaries**
- **Use-case oriented application layer**

То есть не пытаться строить сверхсложный enterprise-DDD, но и не делать «всё в service.ts».

### 7.2. Правила зависимостей

**Разрешённые зависимости:**

- `presentation -> application`
- `application -> domain`
- `infrastructure -> domain`
- `application -> infrastructure` только через DI и интерфейсы
- модуль A не должен напрямую тянуть внутренности модуля B

**Запрещено:**

- обращаться из одного модуля прямо в prisma-сущности другого модуля;
- переиспользовать private DTO другого модуля;
- смешивать HTTP-логику и бизнес-логику;
- писать payment/provider calls прямо в controller.

### 7.3. Общение между модулями

На MVP выбрать:

- синхронное взаимодействие через **application services / facades**
- асинхронное взаимодействие через **domain events / BullMQ** там, где это нужно

**Примеры:**

- `payments` после успешного депозита вызывает wallet use case;
- `wallet` пишет ledger;
- `kyc` обновляет статус пользователя;
- `support` создаёт тикет и уведомление;
- `referrals` реагирует на first deposit event.

---

## 8. Стандарты API

### 8.1. Стиль API

Использовать:

- REST API
- JSON only
- versioning через `/api/v1/...`

Пример:

```bash
/api/v1/auth/register
/api/v1/auth/login
/api/v1/users/me
/api/v1/wallet/balances
/api/v1/payments/deposit
/api/v1/casino/providers
/api/v1/support/tickets
```

### 8.2. Формат ответа API

Все endpoints должны возвращать единый формат:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

или

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": {}
  }
}
```

### 8.3. Формат ошибок

Нужно использовать единые коды ошибок, например:

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `KYC_REQUIRED`
- `PAYMENT_PROVIDER_ERROR`
- `INSUFFICIENT_FUNDS`
- `DUPLICATE_REQUEST`
- `INTERNAL_ERROR`

---

## 9. Работа с деньгами и числами

### 9.1. Критичное правило

Для денежных значений:

- не использовать `float`/`number` как источник истины;
- хранить в БД как `Decimal`;
- в коде использовать decimal-библиотеку;
- в API передавать суммы как строки.

Пример:

```json
{
  "amount": "1500.00",
  "currency": "RUB"
}
```

### 9.2. Валюты MVP

**Fiat:**

- RUB

**Crypto:**

- USDT_TRC20
- BTC
- TON
- TRX
- LTC

Архитектура должна позволять позже добавить:

- ETH
- USDT_ERC20
- USDT_BEP20
- USDC
- EUR/USD fiat

---

## 10. Конфигурация окружений

### 10.1. Окружения

Нужны минимум:

- `local`
- `dev`
- `staging`
- `production`

Если хочешь упростить старт, можно технически жить на:

- local
- production

Но структура конфигов всё равно должна быть готова под 4 окружения.

### 10.2. Конфигурация через env

Вынести конфиги в env:

- app port
- db url
- redis url
- jwt secret
- jwt refresh secret
- google oauth credentials
- telegram bot/support config
- rukassa credentials
- nowpayments api key
- kyc thresholds
- referral settings
- admin seed credentials
- file upload settings
- cors origins
- rate limit settings

---

## 11. Аутентификация и доступ

### 11.1. Для пользователей

Нужно поддержать:

- email + пароль
- Google login
- Telegram login как optional расширение

### 11.2. Для админов

Отдельная auth-модель:

- отдельные роли;
- доступ только в admin app;
- отдельный guard;
- обязательное логирование действий.

### 11.3. JWT модель

Использовать:

- access token
- refresh token
- token rotation
- logout from current session
- logout from all sessions позже можно добавить как расширение

---

## 12. Базовая структура базы данных

### 12.1. Основные сущности foundation-уровня

На этом этапе не нужно расписывать все таблицы полностью, но архитектурно должны быть предусмотрены группы:

- users
- auth_accounts
- sessions
- admin_users
- roles
- permissions
- audit_logs
- kyc_profiles
- wallets
- wallet_transactions
- payment_requests
- payment_callbacks
- provider_catalog
- game_catalog
- game_sessions
- support_tickets
- support_messages
- referral_codes
- referrals
- notifications

### 12.2. Базовые требования к БД

- PostgreSQL как единственная primary database;
- Prisma migrations обязательны;
- никакого auto-sync schema в production;
- индексы обязательно проектировать заранее на `userId`, `status`, `createdAt`, `externalId`, `providerId`;
- все финансовые таблицы должны иметь audit trail;
- все внешние callback-и должны храниться сырыми в отдельной таблице.

---

## 13. Redis и очереди

### 13.1. Redis использовать для

- rate limits;
- caching session-like данных;
- idempotency helpers;
- short-lived provider tokens;
- очередей BullMQ;
- технических locks.

### 13.2. BullMQ использовать для

- отправки email;
- support notifications;
- callback reprocessing;
- provider sync tasks;
- reconciliation jobs;
- referral post-processing;
- audit export jobs.

На MVP **не использовать** Kafka/RabbitMQ.

---

## 14. Логирование и observability

### 14.1. Что логировать

Обязательно логировать:

- auth events;
- failed logins;
- registration;
- payment request creation;
- payment callback receive;
- wallet mutation;
- provider launch session creation;
- KYC status changes;
- support ticket actions;
- referral code usage;
- admin actions;
- unhandled exceptions.

### 14.2. Формат логов

- structured JSON logs;
- correlation id / request id;
- user id если есть;
- module name;
- action type;
- status.

### 14.3. Что не логировать

Нельзя логировать:

- пароли;
- refresh tokens;
- полные секреты;
- приватные ключи;
- платёжные реквизиты целиком;
- документы KYC в логах.

---

## 15. Документация внутри проекта

### 15.1. Обязательные документы в репозитории

Создать папку `docs/` и в ней минимум:

- `ARCHITECTURE.md`
- `STACK.md`
- `API_CONVENTIONS.md`
- `ENVIRONMENT_VARIABLES.md`
- `MODULE_BOUNDARIES.md`
- `SECURITY_BASELINE.md`
- `PAYMENT_OVERVIEW.md`
- `PROVIDER_INTEGRATION_STRATEGY.md`
- `AI_DEVELOPMENT_RULES.md`

### 15.2. Зачем это нужно

Так как код будет писать AI, документация должна быть не «для галочки», а как **источник контекста**, чтобы следующий агент не ломал предыдущую структуру.

---

## 16. Правила для AI-разработки

Отдельно попрошено **убрать правило «файлы < 200 строк»** — убираем.
Но вместо него вводим более правильные правила.

### 16.1. Обновлённые правила

**Обязательно:**

- один модуль = одна чёткая зона ответственности;
- business logic не должна жить в controller;
- все внешние интеграции изолировать в adapter/client слое;
- DTO входа и выхода должны быть явными;
- для всех денежных операций использовать idempotency;
- любые side effects, которые можно повторить, выносить в jobs/events;
- код должен быть предсказуемым и однотипным.

**Желательно:**

- не раздувать один класс до «суперсервиса»;
- большие use case разбивать по сценарию;
- не смешивать auth, wallet, provider и admin logic;
- не писать «умные хелперы», которые скрывают критичную логику.

### 16.2. Правило читаемости вместо лимита по длине файла

Вместо ограничения по строкам использовать правило:

> Если файл перестаёт быть быстро читаемым и в нём смешиваются разные сценарии, его нужно делить на отдельные use cases / services / adapters.

---

## 17. Базовые нефункциональные требования

### 17.1. Производительность

Для MVP принять цели:

- API response p95 < 500ms для обычных CRUD операций;
- provider-dependent операции могут быть медленнее, но должны иметь timeout/retry модель;
- публичный frontend должен открываться быстро на мобильных устройствах.

### 17.2. Надёжность

- backend должен переживать повторные callbacks;
- финансовые операции не должны дублироваться;
- все provider callback-и должны быть идемпотентны;
- критичные операции должны быть трассируемы.

### 17.3. Безопасность

- HTTPS only;
- rate limiting;
- password hashing;
- CSRF strategy для cookie-based flows, либо bearer token strategy без cookie confusion;
- admin routes изолированы;
- audit logs обязательны.

---

## 18. Технические задачи этапа

Ниже уже не описание, а **конкретные задачи**, которые должен выполнить AI-агент.

### Блок A. Инициализация monorepo

**Задачи:**

1. Создать monorepo структуру `apps/`, `packages/`, `docs/`, `infra/`.
2. Настроить package manager.
3. Настроить workspace dependencies.
4. Настроить общий TypeScript config.
5. Настроить общий ESLint config.
6. Настроить Prettier.
7. Настроить path aliases.
8. Настроить базовые npm/pnpm scripts.

**Результат:**

- проект собирается одной командой;
- все приложения видят общие пакеты;
- линтер и типизация работают во всех пакетах.

**Критерий приёмки:**

- `install`, `build`, `lint`, `typecheck` выполняются без ошибок на чистом проекте.

---

### Блок B. Создание backend foundation

**Задачи:**

1. Создать NestJS app `apps/api`.
2. Настроить глобальный prefix `/api/v1`.
3. Настроить validation pipeline.
4. Настроить global exception filter.
5. Настроить response interceptor для единого формата ответа.
6. Настроить config module с env validation.
7. Настроить health module.
8. Настроить request id middleware.
9. Настроить logging layer.
10. Подготовить модульную структуру `modules/`.

**Результат:**

- backend запускается;
- есть базовая инфраструктура для модулей;
- ошибки и ответы единообразны.

**Критерий приёмки:**

- работает `/api/v1/health`;
- невалидный input возвращает единый validation response;
- все запросы получают request id.

---

### Блок C. Создание frontend foundation

**Задачи:**

1. Создать `apps/web` на Next.js.
2. Настроить базовую структуру app router.
3. Настроить Tailwind.
4. Настроить layout:
   - header
   - footer
   - main container
5. Настроить client для API.
6. Настроить env-конфиг frontend.
7. Настроить базовые страницы:
   - главная
   - login
   - register
   - profile placeholder
   - support placeholder

**Результат:**

- web-приложение готово для подключения бизнес-модулей.

**Критерий приёмки:**

- приложение запускается;
- API base url configurable;
- есть рабочий layout и route skeleton.

---

### Блок D. Создание admin foundation

**Задачи:**

1. Создать `apps/admin`.
2. Настроить отдельный layout админки.
3. Подготовить sidebar navigation.
4. Настроить protected route shell.
5. Подготовить placeholder pages:
   - dashboard
   - users
   - transactions
   - kyc
   - support
   - referrals
   - settings
   - audit logs

**Результат:**

- админка готова к подключению auth и данных.

**Критерий приёмки:**

- админка запускается как отдельное приложение;
- страницы и layout готовы.

---

### Блок E. Shared packages

**Задачи:**

1. Создать `shared-types`.
2. Создать `shared-utils`.
3. Создать `shared-config`.
4. Вынести базовые enum:
   - currency
   - user status
   - kyc status
   - admin role
   - transaction status
5. Вынести общие response types.
6. Вынести pagination types.
7. Вынести money helper interfaces.

**Результат:**

- все приложения используют общие типы;
- нет дублирования базовых enum.

**Критерий приёмки:**

- backend/web/admin импортируют типы из shared package без конфликтов.

---

### Блок F. Database foundation

**Задачи:**

1. Создать `packages/database`.
2. Настроить Prisma.
3. Подключить PostgreSQL.
4. Настроить базовый prisma client wrapper.
5. Подготовить первую migration foundation-уровня.
6. Подготовить seed mechanism для:
   - admin user
   - admin roles
   - базовых permissions

**Результат:**

- база поднимается;
- миграции работают;
- есть минимальные сущности для продолжения разработки.

**Критерий приёмки:**

- миграции применяются локально;
- seed создаёт тестового администратора.

---

### Блок G. Infra foundation

**Задачи:**

1. Создать `docker-compose` для:
   - postgres
   - redis
   - api
   - web
   - admin
2. Подготовить Dockerfile для каждого приложения.
3. Подготовить Nginx конфиг для reverse proxy.
4. Подготовить `.env.example`.
5. Подготовить production env template.
6. Подготовить scripts для startup/shutdown/redeploy.

**Результат:**

- проект можно поднять локально и затем перенести на VPS.

**Критерий приёмки:**

- `docker compose up` поднимает все ключевые сервисы.

---

### Блок H. Документация foundation

**Задачи:**

1. Описать архитектуру.
2. Описать правила API.
3. Описать env variables.
4. Описать модульные границы.
5. Описать правила для AI-агента.
6. Описать как запускать проект локально.
7. Описать как деплоить на VPS.

**Результат:**

- следующий AI-агент сможет продолжить работу без потери контекста.

**Критерий приёмки:**

- новый исполнитель может поднять проект только по `docs/` и `.env.example`.

---

## 19. Итоговые артефакты по Часть 1

После завершения этой части должны существовать:

- monorepo;
- backend shell;
- web shell;
- admin shell;
- database package;
- shared packages;
- docker setup;
- nginx config;
- базовые docs;
- foundation migration;
- admin seed.

---

## 20. Что НЕ надо делать в Части 1

Чтобы AI-агент не расползался по задаче, в этой части **не делать**:

- wallet business logic;
- payment integrations;
- Google auth implementation;
- Telegram login implementation;
- KYC business flow;
- game provider integration;
- referral logic;
- support ticket logic;
- user cabinet logic;
- admin data tables and actions.

Только foundation.

---

_Если формат тебе подходит, напиши **«продолжай»** — и я дам **Часть 2: Backend Core — Auth, Users, KYC, RBAC**._
