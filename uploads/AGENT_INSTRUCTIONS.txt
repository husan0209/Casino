---
title: Agent Instructions
description: Machine-readable правила для AI IDE (Cursor/Windsurf/Cline/Claude Code): два формата инструкций в одном файле
audience: AI agents (Cursor, Windsurf, Cline, Claude Code и аналоги)
status: living document
last_updated: 2026-06-19
---

# Agent Instructions

> **Назначение:** Этот документ содержит два готовых набора правил, которые AI IDE подхватывает автоматически:
>
> 1. **.cursorrules section** — для Cursor и Windsurf (формат `.cursorrules` / `.windsurfrules`)
> 2. **CLAUDE.md section** — для Cline и Claude Code (формат `CLAUDE.md`)
>
> Скопируйте содержимое нужной секции в файл с соответствующим именем в корне проекта (только то, что используется).
>
> Этот документ — **короткий набор жёстких правил**. Все обоснования и подробности — в [AI_DEVELOPMENT_RULES.md](./AI_DEVELOPMENT_RULES.md), [CONVENTIONS.md](./CONVENTIONS.md), [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. .cursorrules — Cursor / Windsurf

> Сохранить как `.cursorrules` или `.windsurfrules` в корне проекта.

```
# casino-platform — Cursor Agent Rules

# ── Project context ────────────────────────────────────────
You are working on casino-platform — an online casino for the CIS market (Russian language only on MVP).
Stack: TypeScript + NestJS 11 (modular monolith) + Prisma + PostgreSQL + Redis + BullMQ + Next.js 14.
Architecture: Monorepo (pnpm workspaces + Turborepo), 4-layer modules (domain / application / infrastructure / presentation).

# ── Project structure ──────────────────────────────────────
-   Monorepo root: package.json, pnpm-workspace.yaml, turbo.json
-   Backend:        apps/api/ (NestJS)
-   Frontend:       apps/web/ (Next.js public), apps/admin/ (Next.js admin)
-   Shared:         packages/shared-types, packages/shared-utils, packages/shared-config, packages/database
-   Infra:          infra/docker/, infra/scripts/
-   Docs:           docs/ (this folder)

# ── Module structure (CRITICAL) ────────────────────────────
EVERY backend module under apps/api/src/modules/<name>/ has this EXACT 4-layer layout:

    module-name/
    ├── domain/                ← pure business (NO Prisma, NO Express/Nest)
    │   ├── entities/
    │   ├── value-objects/
    │   ├── enums/
    │   ├── errors/            ← custom error classes extending AppError
    │   └── repositories/      ← interface only
    ├── application/           ← use cases (NO HTTP, NO Prisma direct)
    │   ├── use-cases/
    │   ├── dto/
    │   ├── events/
    │   └── validators/        ← Zod schemas
    ├── infrastructure/        ← external world
    │   ├── repositories/      ← Prisma implementations
    │   ├── adapters/          ← External providers
    │   ├── clients/
    │   ├── mappers/
    │   └── queue/
    ├── presentation/          ← HTTP boundary
    │   ├── controllers/
    │   ├── dtos/              ← class-validator DTOs
    │   ├── guards/
    │   └── interceptors/
    └── module-name.module.ts  ← NestJS module wiring

Rules of dependency (NEVER VIOLATE):
    presentation → application (DTOs only)
    application  → domain
    application  → infrastructure (THROUGH interfaces only)
    infrastructure → domain (for mappers)
    domain       → NOTHING

# ── Cross-module communication ─────────────────────────────
Modules NEVER access each other directly. Always through a Facade:

    // ❌ WRONG
    await prisma.walletAccount.update(...)

    // ✅ RIGHT
    await walletFacade.credit({ userId, currency, amount, idempotencyKey })

Each module exposes ONE Facade class (XxxFacade) registered in NestJS providers.
Other modules inject this facade via DI.

# ── Money — ABSOLUTE RULE #1 ──────────────────────────────
NEVER use number/float for money.
ALWAYS use:
    -   Database: DECIMAL(20, 8)
    -   Code:     string + decimal.js (or big.js)
    -   API:      string in request and response (e.g., "1500.00")
    -   Type:     MoneyAmount from @casino/shared-types

Helpers:  money.add / money.subtract / money.multiply / money.divide from @casino/shared-utils
DO NOT write custom decimal math — use existing helpers.

# ── Idempotency — ABSOLUTE RULE #2 ─────────────────────────
EVERY financial operation MUST have an idempotencyKey and check duplicates BEFORE execution:
    -   credit, debit, lock, unlock of wallet
    -   confirmation of payment
    -   processing of bet/win/rollback from game provider
    -   referral reward calculation
    -   admin manual credit/debit

Format: see AI_DEVELOPMENT_RULES.md §2.3.
Use UNIQUE constraint on ledger_entries.idempotency_key.

# ── API responses — ALWAYS wrapper ─────────────────────────
Return ONLY through helpers from @casino/shared-types:
    successResponse(data)
    successResponse(data, paginationMeta)
    errorResponse(code, message, details?)

NEVER return raw objects from controllers.
NEVER do res.json({error: "..."}) — let GlobalExceptionFilter handle it.

# ── Errors — ALWAYS custom classes ─────────────────────────
Every error extends AppError (abstract, has .code and .httpStatus).
Examples: InsufficientFundsError, WalletNotFoundError, DuplicateRequestError, KycRequiredError.
NEVER throw raw new Error("...").
NEVER throw NestJS HttpException manually.

# ── Before creating new module ─────────────────────────────
MUST read in order:
    1.  docs/AI_DEVELOPMENT_RULES.md
    2.  docs/MODULE_BOUNDARIES.md
    3.  docs/MODULE_TEMPLATE.md (step-by-step)
    4.  Relevant docs/CONVENTIONS.md sections
    5.  Relevant TZ part (tz-part-*.md)
    6.  packages/shared-types/ for existing types/enums
    7.  packages/database/prisma/schema/ for current DB structure

# ── Before modifying existing code ─────────────────────────
Check:
    -   This module's README.md (if exists)
    -   Other modules' Facades that may consume what you're changing
    -   Whether shared-types/ has a type you should reuse
    -   Whether events.ts has an event you should emit

# ── Database ───────────────────────────────────────────────
-   Schema is SPLIT into multiple files: packages/database/prisma/schema/<area>.prisma
    Schema root:    prisma/schema.prisma (imports all)
    Migrations:     prisma/migrations/
-   ALWAYS use $transaction for multi-table financial ops
-   Use optimistic locking via version field on wallet_accounts
-   On OptimisticLockError → retry 3 times with exponential backoff
-   NEVER do prisma.walletAccount.update() directly — use WalletFacade

# ── Stack specifics ────────────────────────────────────────
Backend:    NestJS 11 (NOT Express standalone)
ORM:        Prisma 5.x
Validation: Zod (own) + class-validator (NestJS DTOs)
Logging:    Pino with structured JSON + redact for secrets
Queue:      BullMQ (NOT Kafka, NOT raw queues)
Cache:      Redis 7 via ioredis
Realtime:   NOT used on MVP (polling only)
Frontend:   Next.js 14 App Router + Tailwind + TanStack Query + Zustand + React Hook Form + Zod

# ── Don't do ───────────────────────────────────────────────
-   ❌ Use number type for money anywhere
-   ❌ Hardcode secrets, URLs, API keys
-   ❌ Log passwords, tokens, full card numbers, KYC documents
-   ❌ Import one module's repository into another module
-   ❌ Mix HTTP layer and business logic in same method
-   ❌ Update wallet_accounts without going through WalletFacade
-   ❌ Process webhook without saving raw body first
-   ❌ Duplicate-check financial op without idempotency_key
-   ❌ Return res.json() from controller — use helpers
-   ❌ Throw Error("...") — use domain error classes
-   ❌ Make module depend on another module's domain/

# ── Commands quick reference ───────────────────────────────
-   pnpm install         install deps
-   pnpm dev             run api + web + admin in parallel
-   pnpm build           build all
-   pnpm typecheck       tsc --noEmit across workspace
-   pnpm lint            eslint .
-   pnpm test            vitest (unit tests)
-   pnpm db:generate     prisma generate
-   pnpm db:migrate      prisma migrate dev
-   pnpm db:deploy       prisma migrate deploy (prod)
-   pnpm db:studio       prisma studio (GUI)
-   pnpm --filter @casino/api <cmd>  run inside one package
```

---

## 2. CLAUDE.md — Cline / Claude Code

> Сохранить как `CLAUDE.md` в корне проекта.

```markdown
# casino-platform — Claude / Cline Instructions

## Контекст проекта
Online casino платформа для рынка СНГ. MVP на русском языке.
Монорепо: NestJS backend + Next.js frontend (web + admin).
Архитектура: modular monolith, 4-layer modules (domain/application/infrastructure/presentation).

## Обязательный bootstrap

Прежде чем что-то менять в коде, прочитай в этом порядке:

1.  `docs/AI_DEVELOPMENT_RULES.md` — критичные правила (деньги, идемпотентность, ошибки)
2.  `docs/ARCHITECTURE.md` — архитектурные решения
3.  `docs/CONVENTIONS.md` — coding conventions
4.  `docs/MODULE_BOUNDARIES.md` — карта модулей и их границ
5.  `docs/MODULE_TEMPLATE.md` — пошаговый шаблон создания модуля
6.  Релевантная TZ-часть (tz-part-1 ... tz-part-7)
7.  `packages/shared-types/src/` — существующие типы и enum-ы
8.  `packages/database/prisma/schema/` — текущая структура БД

Если задача — создать новый модуль — ОБЯЗАТЕЛЬНО прочитай `MODULE_TEMPLATE.md` и следуй ему.

## Жёсткие правила (никогда не нарушать)

1.  **Деньги** — никогда `number`/`float`. Только `string` + `decimal.js`. В БД — `DECIMAL(20,8)`. Helpers в `@casino/shared-utils` (`money.add` и т.д.).
2.  **Идемпотентность** — каждая финансовая операция требует `idempotencyKey` с проверкой дубликата ДО выполнения.
3.  **Структура модуля** — 4 слоя. Бизнес-логика ТОЛЬКО в `application/use-cases/`. HTTP ТОЛЬКО в `presentation/controllers/`. БД ТОЛЬКО в `infrastructure/repositories/`.
4.  **Межмодульное общение** — только через Facade другого модуля. Никогда не импортируй `Repository` одного модуля в другой.
5.  **API ответы** — всегда через `successResponse()` / `errorResponse()` из `@casino/shared-types`. Никогда сырой объект.
6.  **Ошибки** — всегда кастомный класс, расширяющий `AppError`. Код ошибки стабильный (например `INSUFFICIENT_FUNDS`), есть `httpStatus`.
7.  **Безопасность** — не логируй пароли, токены, номера карт, документы. Валидируй через Zod. Проверяй права в Guard.
8.  **Транзакции БД** — все финансовые multi-table операции в `prisma.$transaction()`. Optimistic locking retry до 3 раз.
9.  **Webhook** — сначала сохранить raw callback в БД, потом обрабатывать. Всегда возвращать 200 OK провайдеру.

## Типичные задачи

### Создать новый модуль
→ открой `docs/MODULE_TEMPLATE.md`, следуй 10 шагам.
→ После создания обнови `docs/MODULE_BOUNDARIES.md` (добавь модуль в карту).

### Добавить новый API endpoint
→ Найти существующий controller в `apps/api/src/modules/<name>/presentation/controllers/`
→ Если бизнес-логика > 30 строк → создать/дополнить `application/use-cases/<action>.use-case.ts`
→ Никогда не добавлять логику прямо в controller
→ Использовать `successResponse()` в controller, exceptions — `throw new XxxError()`

### Добавить новое событие
→ Добавить тип в `apps/api/src/events/events.ts`
→ Добавить handler в подписчике (обычно в `application/events/handlers/`)
→ Документировать в `MODULE_BOUNDARIES.md` как cross-module связь

### Добавить новую таблицу
→ Schema вынесена в файлы по доменам: `packages/database/prisma/schema/<area>.prisma`
→ Создать миграцию: `pnpm db:migrate --name <name>`
→ Обновить seed если данные фиксированные

### Добавить новый платёжный провайдер
→ Создать адаптер в `modules/payments/infrastructure/adapters/`
→ Реализовать `PaymentProvider` interface из `modules/payments/domain/`
→ Зарегистрировать в `PaymentsModule` через DI
→ Подробнее: `docs/PAYMENT_OVERVIEW.md`

### Добавить нового game-провайдера
→ Создать `ProviderAdapter` в `modules/game-sessions/infrastructure/adapters/`
→ Подробнее: `docs/PROVIDER_INTEGRATION_STRATEGY.md`

## Команды для разработки

| Команда                  | Что делает                                 |
|--------------------------|--------------------------------------------|
| `pnpm install`           | Установить зависимости                     |
| `pnpm dev`               | Запустить api + web + admin локально       |
| `pnpm build`             | Собрать всё                                |
| `pnpm typecheck`         | Проверить TypeScript по всему монорепо     |
| `pnpm lint`              | ESLint по всему монорепо                   |
| `pnpm test`              | Vitest (unit тесты)                        |
| `pnpm test:e2e`          | E2E тесты (требует поднятую БД)            |
| `pnpm db:generate`       | Prisma generate                            |
| `pnpm db:migrate`        | Создать миграцию (dev)                     |
| `pnpm db:deploy`         | Применить миграции (prod)                  |
| `pnpm db:studio`         | GUI для БД                                 |
| `pnpm --filter @casino/api <cmd>` | Запустить команду в одном пакете |

## Когда СПРОСИТЬ пользователя

Прежде чем действовать, если:
-   Не описано в TZ архитектурное решение (например, новая подсистема)
-   Выбор между двумя валидными подходами с разными trade-off (например, sync vs async)
-   Изменение схемы БД, не описанное в `tz-part-*.md`
-   Бизнес-правило для edge case, не покрытого в TZ

→ Остановись и спроси пользователя. Не угадывай.

## Что НЕ делать

-   Не пиши `number` для денег — пиши `string`
-   Не делай `prisma.x.update()` напрямую вне `infrastructure/repositories/`
-   Не импортируй Facade одного модуля в Domain слой другого
-   Не возвращай объект напрямую из controller — используй `successResponse()`
-   Не используй `console.log` для production-логирования — используй Pino
-   Не создавай новый enum/type — сначала проверь `packages/shared-types`
-   Не игнорируй Promise (`this.sendEmail()` без `await`)
-   Не делай HTTP-запрос из контроллера к другому контроллеру
```

---

## 3. Когда какой формат использовать

| IDE / Agent                  | Файл в корне проекта     | Какую секцию копировать      |
|------------------------------|--------------------------|-----------------------------|
| Cursor                       | `.cursorrules`           | § 1 (`.cursorrules section`) |
| Windsurf                     | `.windsurfrules`         | § 1 (`.cursorrules section`) |
| Cline (VS Code extension)    | `.clinerules`            | § 2 (`CLAUDE.md section`)   |
| Claude Code (CLI)            | `CLAUDE.md`              | § 2 (`CLAUDE.md section`)   |
| Aider                        | `.aider.conf.yml` + `CONVENTIONS.md` | § 1 + ссылка на CONVENTIONS |
| Continue.dev                 | `.continue/config.json`  | Вручную из § 1 или § 2      |
| Другое AI IDE                | Свой формат              | Адаптировать из § 1 или § 2 |

---

## 4. Чего в этих файлах НЕТ (и не должно быть)

Это короткие правила, не документация. Если нужны подробности — читай:

-   Обоснование выбора стека → [STACK.md](./STACK.md)
-   Полный API контракт → [API_CONVENTIONS.md](./API_CONVENTIONS.md)
-   Безопасность → [SECURITY_BASELINE.md](./SECURITY_BASELINE.md)
-   Деньги / ошибки / idempotency детально → [AI_DEVELOPMENT_RULES.md](./AI_DEVELOPMENT_RULES.md)
-   Карта модулей → [MODULE_BOUNDARIES.md](./MODULE_BOUNDARIES.md)
-   Шаблон нового модуля → [MODULE_TEMPLATE.md](./MODULE_TEMPLATE.md)
-   Конвенции кода → [CONVENTIONS.md](./CONVENTIONS.md)
-   High-level обзор → [README.md](../README.md)

---

## 5. Проверка: всё ли покрыто?

Прежде чем начать разработку с AI-агентом по этим правилам, проверь что агент «видит» документы:

```bash
# Список критичных файлов
ls -la \
  .cursorrules CLAUDE.md \
  docs/AI_DEVELOPMENT_RULES.md \
  docs/ARCHITECTURE.md \
  docs/CONVENTIONS.md \
  docs/MODULE_BOUNDARIES.md \
  docs/MODULE_TEMPLATE.md \
  README.md
```

Если какого-то файла нет — создай его перед стартом.

---

> **Главный принцип:** этот файл — стартовый набор для AI. Если в коде нарушается любое правило из § 1 или § 2 — есть 99% вероятность что код нужно переписать. Прочитать релевантный docs/, понять, почему правило существует, и только потом менять правило (обновив и docs/).
