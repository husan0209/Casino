# casino-platform — Agent Instructions (opencode / Claude Code / Cline)

> Источник: `docs/AGENT_INSTRUCTIONS.md` §2. Синхронизировано 2026-08-22.
> Для Cursor/Windsurf см. `.cursorrules` в корне.

## Контекст проекта

Online casino платформа для рынка СНГ. MVP на русском языке.
Монорепо: NestJS backend + Next.js frontend (web + admin).
Архитектура: modular monolith, 4-layer modules (domain/application/infrastructure/presentation).

## Обязательный bootstrap

Прежде чем что-то менять в коде, прочитай в этом порядке:

1. `docs/AI_DEVELOPMENT_RULES.md` — критичные правила (деньги, идемпотентность, ошибки)
2. `docs/ARCHITECTURE.md` — архитектурные решения
3. `docs/CONVENTIONS.md` — coding conventions
4. `docs/MODULE_BOUNDARIES.md` — карта модулей и их границ
5. `docs/MODULE_TEMPLATE.md` — пошаговый шаблон создания модуля
6. Релевантная TZ-часть (`docs/tz-part-1` … `docs/tz-part-7`)
7. `packages/shared-types/src/` — существующие типы и enum-ы
8. `packages/database/prisma/schema.prisma` — текущая структура БД

Если задача — создать новый модуль — ОБЯЗАТЕЛЬНО прочитай `MODULE_TEMPLATE.md` и следуй ему.

## Жёсткие правила (никогда не нарушать)

1. **Деньги** — никогда `number`/`float`. Только `string` + `decimal.js`. В БД — `DECIMAL(20,8)`. Helpers в `@casino/shared-utils` (`money.add` и т.д.).
2. **Идемпотентность** — каждая финансовая операция требует `idempotencyKey` с проверкой дубликата ДО выполнения.
3. **Структура модуля** — 4 слоя. Бизнес-логика ТОЛЬКО в `application/use-cases/`. HTTP ТОЛЬКО в `presentation/controllers/`. БД ТОЛЬКО в `infrastructure/repositories/`.
4. **Межмодульное общение** — только через Facade другого модуля. Никогда не импортируй `Repository` одного модуля в другой.
5. **API ответы** — всегда через `successResponse()` / `errorResponse()` из `@casino/shared-types`. Никогда сырой объект.
6. **Ошибки** — всегда кастомный класс, расширяющий `AppError`. Код ошибки стабильный (например `INSUFFICIENT_FUNDS`), есть `httpStatus`.
7. **Безопасность** — не логируй пароли, токены, номера карт, документы. Валидируй через Zod. Проверяй права в Guard.
8. **Транзакции БД** — все финансовые multi-table операции в `prisma.$transaction()`. Optimistic locking retry до 3 раз.
9. **Webhook** — сначала сохранить raw callback в БД, потом обрабатывать. Всегда возвращать 200 OK провайдеру.

## Типичные задачи

### Создать новый модуль
→ открой `docs/MODULE_TEMPLATE.md`, следуй 10 шагам.
→ После создания обнови `docs/MODULE_BOUNDARIES.md` (добавь модуль в карту).

### Добавить новый API endpoint
→ Найди существующий controller в `apps/api/src/modules/<name>/presentation/controllers/`
→ Если бизнес-логика > 30 строк → создай/дополни `application/use-cases/<action>.use-case.ts`
→ Никогда не добавляй логику прямо в controller
→ Используй `successResponse()` в controller, exceptions — `throw new XxxError()`

### Добавить новую таблицу
→ Schema: `packages/database/prisma/schema.prisma`
→ Создай миграцию: `pnpm db:migrate --name <name>`
→ Обнови seed если данные фиксированные

### Добавить нового платёжного провайдера
→ Создай адаптер в `modules/payments/infrastructure/adapters/`
→ Реализуй `PaymentProvider` interface из `modules/payments/domain/`
→ Зарегистрируй в `PaymentsModule` через DI
→ Подробнее: `docs/PAYMENT_OVERVIEW.md`

### Добавить нового game-провайдера
→ Создай `ProviderAdapter` в `modules/casino/infrastructure/providers/`
→ Зарегистрируй в `ProviderAdapterFactory`
→ Подробнее: `docs/PROVIDER_INTEGRATION_STRATEGY.md`

## Команды для разработки

| Команда | Что делает |
|---------|-----------|
| `pnpm install` | Установить зависимости |
| `pnpm dev` | Запустить api + web + admin локально |
| `pnpm build` | Собрать всё |
| `pnpm typecheck` | Проверить TypeScript по всему монорепо |
| `pnpm lint` | ESLint по всему монорепо |
| `pnpm test` | Vitest (unit тесты) |
| `pnpm test:e2e` | E2E тесты (требует поднятую БД) |
| `pnpm db:generate` | Prisma generate |
| `pnpm db:migrate` | Создать миграцию (dev) |
| `pnpm db:deploy` | Применить миграции (prod) |
| `pnpm db:studio` | GUI для БД |
| `pnpm --filter @casino/api <cmd>` | Запустить команду в одном пакете |

## Когда СПРОСИТЬ пользователя

Прежде чем действовать, если:
- Не описано в TZ архитектурное решение (например, новая подсистема)
- Выбор между двумя валидными подходами с разными trade-off (например, sync vs async)
- Изменение схемы БД, не описанное в `tz-part-*.md`
- Бизнес-правило для edge case, не покрытого в TZ

→ Остановись и спроси пользователя. Не угадывай.

## Что НЕ делать

- Не пиши `number` для денег — пиши `string`
- Не пиши однострочные методы (запрещены one-liners в контроллерах и сервисах)
- Не используй сокращения и однобуквенные переменные (`u`, `b`, `q`, `r`, `ru`, `rr`, `cur`) — всегда пиши полные имена: `currentUser`, `dto`, `queryParams`, `ticketId`, `currency`
- Не делай `prisma.x.update()` напрямую вне `infrastructure/repositories/`
- Не импортируй Facade одного модуля в Domain слой другого
- Не возвращай объект напрямую из controller — используй `successResponse()`
- Не используй `console.log` для production-логирования — используй Pino
- Не создавай новый enum/type — сначала проверь `packages/shared-types`
- Не игнорируй Promise (`this.sendEmail()` без `await`)
- Не делай HTTP-запрос из контроллера к другому контроллеру

## Текущее состояние реализации

⚠️ README содержит честный статус по частям ТЗ (раздел «TZ Progress»).
Полный список расхождений ТЗ↔код: `docs/IMPLEMENTATION_GAPS.md`.
Перед тем как заявлять «готово» — сверяйся с этим файлом и не отмечай задачу выполненной, пока она реально не работает end-to-end.
