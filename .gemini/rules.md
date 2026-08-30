# Casino Platform — Gemini / Antigravity Agent Rules

> **См. также:** `casino-platform/AGENTS.md` (Claude/Cline/opencode), `casino-platform/.cursorrules` (Cursor/Windsurf).
> Проект разрабатывается несколькими AI-агентами параллельно.

## Контекст проекта

Online casino платформа для рынка СНГ. MVP на русском языке.
- **Монорепо:** NestJS backend + Next.js frontend (web + admin).
- **Архитектура:** modular monolith, 4-layer modules (`domain` / `application` / `infrastructure` / `presentation`).
- **Стек:** TypeScript + NestJS 11 + Prisma + PostgreSQL + Redis + BullMQ + Next.js 14.

---

## Структура проекта

- **Корень монорепо:** `casino-platform/` (`package.json`, `pnpm-workspace.yaml`)
- **Backend:** `casino-platform/apps/api/` (NestJS 11)
- **Frontend:**
  - `casino-platform/apps/web/` (Next.js 14 — публичный веб-интерфейс игрока)
  - `casino-platform/apps/admin/` (Next.js 14 — панель администратора)
- **Общие пакеты:**
  - `casino-platform/packages/shared-types/` (общие TypeScript типы, интерфейсы, DTO, енумы)
  - `casino-platform/packages/shared-utils/` (утилиты: money, crypto, pagination, etc.)
  - `casino-platform/packages/shared-config/` (общие конфигурации)
  - `casino-platform/packages/database/` (Prisma schema, миграции, seeds)
- **Инфраструктура:** `casino-platform/infra/docker/`, `casino-platform/infra/scripts/`
- **Документация:** `casino-platform/docs/` (29 документов архитектуры и ТЗ)

---

## Обязательный bootstrap

Прежде чем что-то менять в коде, прочитай в этом порядке:

1. `casino-platform/docs/AI_DEVELOPMENT_RULES.md` — критичные правила (деньги, идемпотентность, ошибки)
2. `casino-platform/docs/ARCHITECTURE.md` — архитектурные решения
3. `casino-platform/docs/CONVENTIONS.md` — coding conventions
4. `casino-platform/docs/MODULE_BOUNDARIES.md` — карта модулей и их границ
5. `casino-platform/docs/MODULE_TEMPLATE.md` — пошаговый шаблон создания модуля (если задача — создать новый модуль)
6. Релевантная TZ-часть (`casino-platform/docs/tz-part-1-foundation.md` … `casino-platform/docs/tz-part-7-devops-security-qa.md`)
7. `casino-platform/packages/shared-types/src/` — существующие типы и enum-ы
8. `casino-platform/packages/database/prisma/schema.prisma` — текущая структура БД

Если задача — создать новый модуль — **ОБЯЗАТЕЛЬНО** прочитай `casino-platform/docs/MODULE_TEMPLATE.md` и следуй ему.

---

## Структура модулей (4-слойная архитектура)

Каждый бэкенд модуль в `casino-platform/apps/api/src/modules/<name>/` имеет строгую 4-слойную структуру:

```
module-name/
├── domain/                ← чистая бизнес-логика (БЕЗ Prisma, БЕЗ Express/Nest)
│   ├── entities/
│   ├── value-objects/
│   ├── enums/
│   ├── errors/            ← кастомные классы ошибок, наследующие AppError
│   └── repositories/      ← только интерфейсы
├── application/           ← use cases (БЕЗ прямого HTTP, БЕЗ прямого Prisma)
│   ├── use-cases/
│   ├── dto/
│   ├── events/
│   └── validators/        ← Zod схемы
├── infrastructure/        ← внешний мир
│   ├── repositories/      ← Prisma реализации
│   ├── adapters/          ← внешние провайдеры / интеграции
│   ├── clients/
│   ├── mappers/
│   └── queue/
├── presentation/          ← HTTP слой
│   ├── controllers/
│   ├── dtos/              ← class-validator DTOs
│   ├── guards/
│   └── interceptors/
└── module-name.module.ts  ← NestJS модуль
```

**Правила зависимостей (НИКОГДА НЕ НАРУШАТЬ):**
- `presentation` → `application` (только DTOs)
- `application` → `domain`
- `application` → `infrastructure` (ТОЛЬКО через интерфейсы)
- `infrastructure` → `domain` (для мапперов)
- `domain` → **НИЧЕГО** (полная изоляция)

---

## Жёсткие правила (никогда не нарушать)

1. **Деньги** — никогда `number`/`float`. Только `string` + `decimal.js`. В БД — `DECIMAL(20,8)`. Helpers в `@casino/shared-utils` (`money.add`, `money.subtract`, `money.multiply`, `money.divide`). Тип: `MoneyAmount` из `@casino/shared-types`.
2. **Идемпотентность** — каждая финансовая операция требует `idempotencyKey` с проверкой дубликата ДО выполнения (credit/debit/lock/unlock кошелька, подтверждение платежа, обработка bet/win/rollback от провайдеров игр, реферальные начисления, ручные операции админа). Уникальный индекс на `ledger_entries.idempotency_key`.
3. **Структура модуля** — 4 слоя. Бизнес-логика ТОЛЬКО в `application/use-cases/`. HTTP ТОЛЬКО в `presentation/controllers/`. БД ТОЛЬКО в `infrastructure/repositories/`.
4. **Межмодульное общение** — только через Facade другого модуля (например, `WalletFacade`). Никогда не импортируй `Repository` одного модуля в другой. Никогда не делай прямых изменений в чужих таблицах БД.
5. **API ответы** — всегда через `successResponse()` / `errorResponse()` из `@casino/shared-types`. Никогда не возвращай сырой объект из контроллера.
6. **Ошибки** — всегда кастомный класс, расширяющий `AppError`. Код ошибки стабильный (например, `INSUFFICIENT_FUNDS`, `WALLET_NOT_FOUND`), задан `httpStatus`. Никогда не делать `throw new Error(...)` или вручную `HttpException`.
7. **Безопасность** — не логируй пароли, токены, полные номера карт, KYC документы. Валидируй входные данные через Zod / class-validator. Проверяй права в Guard.
8. **Транзакции БД** — все финансовые multi-table операции в `prisma.$transaction()`. Optimistic locking через поле `version` на `wallet_accounts` с retry до 3 раз при `OptimisticLockError`.
9. **Webhook** — сначала сохранить raw callback/body в БД, потом обрабатывать. Всегда возвращать 200 OK провайдеру.

---

## Что НЕ делать

- ❌ Не пиши `number`/`float` для денег — пиши `string`
- ❌ Не пиши однострочные методы (запрещены one-liners в контроллерах и сервисах)
- ❌ Не используй сокращения и однобуквенные переменные (`u`, `b`, `q`, `r`, `ru`, `rr`, `cur`) — пиши полные читаемые имена: `currentUser`, `dto`, `queryParams`, `ticketId`, `currency`
- ❌ Не делай `prisma.x.update()` напрямую вне `infrastructure/repositories/`
- ❌ Не обновляй `wallet_accounts` напрямую без вызова `WalletFacade`
- ❌ Не импортируй Facade одного модуля в Domain слой другого
- ❌ Не импортируй `Repository` одного модуля в другой модуль
- ❌ Не возвращай объект напрямую или `res.json()` из controller — используй `successResponse()` / `errorResponse()`
- ❌ Не используй `console.log` для production-логирования — используй Pino
- ❌ Не создавай новый enum/type — сначала проверь `@casino/shared-types`
- ❌ Не игнорируй Promise (`this.sendEmail()` без `await`)
- ❌ Не делай HTTP-запрос из одного контроллера к другому контроллеру
- ❌ Не хардкодь секреты, URL-ы и API ключи
- ❌ Не обрабатывай вебхук без предварительного сохранения сырого тела в БД
- ❌ Не выбрасывай стандартный `new Error(...)` — используй доменные ошибки на базе `AppError`

---

## Когда СПРОСИТЬ пользователя

Прежде чем действовать, если:
- Не описано в TZ архитектурное решение (например, новая подсистема)
- Выбор между двумя валидными подходами с разными trade-off (например, sync vs async)
- Изменение схемы БД, не описанное в `tz-part-*.md`
- Бизнес-правило для edge case, не покрытого в TZ

→ **Остановись и спроси пользователя. Не угадывай.**

---

## Типичные задачи

### Создать новый модуль
→ Открой `casino-platform/docs/MODULE_TEMPLATE.md`, следуй 10 шагам.  
→ После создания обнови `casino-platform/docs/MODULE_BOUNDARIES.md` (добавь модуль в карту).

### Добавить новый API endpoint
→ Найди существующий controller в `casino-platform/apps/api/src/modules/<name>/presentation/controllers/`  
→ Если бизнес-логика > 30 строк → создай/дополни `application/use-cases/<action>.use-case.ts`  
→ Никогда не добавляй логику прямо в controller  
→ Используй `successResponse()` в controller, exceptions — `throw new XxxError()`

### Добавить новую таблицу / изменить БД
→ Schema: `casino-platform/packages/database/prisma/schema.prisma`  
→ Создай миграцию: `pnpm db:migrate --name <name>` (внутри `casino-platform/`)  
→ Обнови seed если данные фиксированные

### Добавить нового платёжного провайдера
→ Создай адаптер в `casino-platform/apps/api/src/modules/payments/infrastructure/adapters/`  
→ Реализуй `PaymentProvider` interface из `modules/payments/domain/`  
→ Зарегистрируй в `PaymentsModule` через DI  
→ Подробнее: `casino-platform/docs/PAYMENT_OVERVIEW.md`

### Добавить нового game-провайдера
→ Создай `ProviderAdapter` в `casino-platform/apps/api/src/modules/casino/infrastructure/providers/`  
→ Зарегистрируй в `ProviderAdapterFactory`  
→ Подробнее: `casino-platform/docs/PROVIDER_INTEGRATION_STRATEGY.md`

---

## Команды для разработки

Все команды запускаются из папки `casino-platform/`:

| Команда | Что делает |
|---------|-----------|
| `pnpm install` | Установить зависимости во всем монорепо |
| `pnpm dev` | Запустить api + web + admin локально в параллели |
| `pnpm build` | Собрать все пакеты и приложения |
| `pnpm typecheck` | Проверить TypeScript (`tsc --noEmit`) по всему монорепо |
| `pnpm lint` | ESLint по всему монорепо |
| `pnpm test` | Vitest (unit тесты) |
| `pnpm test:e2e` | E2E тесты (требует поднятую БД) |
| `pnpm db:generate` | Prisma generate |
| `pnpm db:migrate` | Создать и применить миграцию (dev) |
| `pnpm db:deploy` | Применить существующие миграции (prod) |
| `pnpm db:studio` | Запустить Prisma Studio (GUI для БД) |
| `pnpm --filter @casino/api <cmd>` | Запустить команду в одном конкретном пакете |

---

## Текущее состояние реализации

⚠️ `casino-platform/README.md` содержит честный статус по частям ТЗ (раздел «TZ Progress»).  
Полный список расхождений ТЗ↔код: `casino-platform/docs/IMPLEMENTATION_GAPS.md`.  
Перед тем как заявлять «готово» — сверяйся с этим файлом и не отмечай задачу выполненной, пока она реально не работает end-to-end.
