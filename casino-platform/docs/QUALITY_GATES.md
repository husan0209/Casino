---
title: Quality Gates
description: Как ESLint-strict и architecture-guards защищают casino-platform от регрессий
status: living document
audience: разработчики, AI-агенты, ревьюеры
last_updated: 2026-08-25
---

# Quality Gates

> **Зачем этот документ:** В проекте есть `docs/AI_DEVELOPMENT_RULES.md` (892 строки правил) и `docs/SECURITY_BASELINE.md`. Но текстовые правила LLM не применяет автоматически. Чтобы правила работали — они должны быть **выражены как код**: либо ESLint-правила, либо grep-скрипты в CI.
>
> Этот документ описывает Tier 1 + Tier 2 защиты, внедрённые 2026-08-25 как реакция на `docs/AUDIT_REPORT.md`. Tier 3 (AI-reviewer) не внедряется — каждый разработчик/агент читает правила **сам** через `AGENTS.md` + `AI_DEVELOPMENT_RULES.md`.

---

## 1. Сводка

| Tier | Что | Где | Что ловит |
|------|-----|-----|-----------|
| **Tier 1** | ESLint (strict) | `.eslintrc.js` | `any`, `console.log`, `parseFloat`, циклы модулей, длинные методы, прямые импорты prisma в domain/application |
| **Tier 2** | Architecture guards (CI) | `.github/workflows/architecture-guards.yml` | 12 grep-проверок, которых ESLint не умеет: webhook raw body, Serializable в транзакциях, KYC fileFilter, Dockerfile USER, refresh-cookie secure, и т.д. |

**Эти два tier'а ловят ~80% нарушений из `AUDIT_REPORT.md`** (25 найденных багов). Остальные 20% (HMAC на raw body в `main.ts`, конкретные баги в бизнес-логике) требуют **ручного code review** — их ESLint не поймает.

---

## 2. Tier 1: ESLint

### 2.1. Что ужесточено (warn → error)

Все эти правила были `warn` в предыдущей версии `.eslintrc.js`, что означало: lint warning ≠ CI fail. Теперь они **`error`** → CI красный, merge заблокирован.

| Правило | Было | Стало | Ловит в коде |
|---------|------|-------|--------------|
| `no-console` | warn | **error** | `console.log` в production-коде (AUDIT §C2) |
| `@typescript-eslint/no-explicit-any` | warn | **error** | `any` тип (AUDIT §C5, в коде: `toMoney(n: any)`) |
| `import/no-cycle` | warn | **error** | Циклы в модулях (скрытые баги зависимостей) |
| `react-hooks/exhaustive-deps` | warn | **error** | Stale closures (в React-коде) |
| `max-params` (3) | warn | **error** | Функции с >3 параметрами |
| `max-depth` (3) | warn | **error** | Вложенность >3 |
| `complexity` (10) | warn | **error** | Cyclomatic complexity >10 |
| `max-lines-per-function` (60) | warn | **error** | Методы >60 строк |

### 2.2. Что добавлено

**`no-restricted-imports` для domain/application слоёв:**

```js
// .eslintrc.js → overrides
files: [
  'apps/api/src/modules/**/domain/**/*.ts',
  'apps/api/src/modules/**/application/**/*.ts',
],
rules: {
  'no-restricted-imports': ['error', {
    patterns: [{
      group: ['@casino/database', '**/.prisma/**'],
      message: 'Direct prisma import in domain/application is FORBIDDEN. Use a repository interface or a Facade.',
    }],
  }],
},
```

**Ловит:** AUDIT §A3, A4, H5 — `prisma.userSettings.findUnique` в `login.use-case.ts`, прямой `prisma` в других use-cases. **Это главный ловец архитектурных нарушений.**

### 2.3. Что НЕ ужесточалось (намеренно)

- `any` в тестах (`*.spec.ts`, `*.test.ts`) — `overrides` отключает. AI_DEVELOPMENT_RULES §10: тесты проверяют поведение, а не стиль.
- `complexity` / `max-depth` / `max-lines-per-function` в тестах — то же самое.
- DTO-файлы (presentation/dtos) — они Zod-схемы, иногда длинные.

### 2.4. Локальный запуск

```bash
cd casino-platform
pnpm lint                      # все файлы
pnpm lint apps/api/src/modules/payments   # конкретный модуль
pnpm lint --fix                # auto-fix (только для safe правил)
```

В CI: `pnpm lint` (без `|| true` — теперь exit-code реален). ВАЖНО: если в `ci.yml` есть `pnpm lint || true` — **убери `|| true`**, иначе Tier 1 не работает.

### 2.5. Ожидаемый эффект

После ужесточения **первый запуск** упадёт. Это **нормально** — это и есть enforcement. Действия:

1. Запусти `pnpm lint` локально.
2. Посмотри список нарушений.
3. Для каждого:
   - Если нарушение **реальное** → исправь.
   - Если нарушение **ложное** (например, в `process-rukassa-webhook` нужно `prisma` напрямую потому что нет репозитория) → создай репозиторий или добавь `// eslint-disable-next-line` **с обоснованием в комментарии**.

---

## 3. Tier 2: Architecture Guards (CI)

### 3.1. Что это

Отдельный workflow `.github/workflows/architecture-guards.yml` с **12 grep-проверками**. Каждая проверка — это `bash`-скрипт, который:
- Что-то ищет в коде (`grep`)
- Если нашёл — fail с сообщением, в котором указан ID бага из AUDIT_REPORT.md

Эти проверки **нельзя** выразить через ESLint (например, "есть ли в `main.ts` `rawBody`?", "есть ли в каждом `*.Dockerfile` директива `USER`?").

### 3.2. Список проверок

| # | ID | Что проверяет | AUDIT § | Severity |
|---|----|--------------|---------|----------|
| G1 | no prisma in domain/application | grep `from '@casino/database'` в domain/ и application/ | A3, A4, H5 | 🔴 |
| G2 | no @ts-ignore / @ts-nocheck | grep в src, исключая тесты | C1 | 🟠 |
| G3 | no console.log in api | grep `console.log(` | C2 | 🟠 |
| G4 | no `@Body() any` | grep в controllers | C3, N8, N9 | 🔴 |
| G5 | webhook raw body | если есть webhook controller, в main.ts должен быть `rawBody` | N5 | 🔴 |
| G6 | no `status.includes` in payments | grep `status.includes` в payments | H3 | 🔴 |
| G7 | wallet ops use Serializable | подсчёт `$transaction` vs `Serializable` | H1 | 🔴 |
| G8 | KYC upload has fileFilter | если есть FileInterceptor, должен быть fileFilter | N6 | 🔴 |
| G9 | refresh cookie secure conditional | grep `secure: false` в auth | N7 | 🔴 |
| G10 | Dockerfile USER directive | каждый `*.Dockerfile` имеет `USER` | N11 | 🔴 |
| G11 | env.example short placeholders | grep длинных `dev_*_REPLACE_WITH` | N10 | 🟠 |
| G12 | branch name convention | PR branch начинается с `feat/`, `fix/` и т.д. | CONVENTIONS §10.1 | 🟡 |

### 3.3. Как читать лог

Если CI красный, в логе будет:

```
❌ G6 FAIL: string-match on payment status is unsafe:
apps/api/src/modules/payments/application/use-cases/process-rukassa-webhook.use-case.ts:34:  const success = ['paid','success','completed','confirm'].some(s => status.includes(s))
   See AUDIT_REPORT.md §H3.
   'status.includes("paid")' matches 'unpaid', 'prepaid', etc.
   Use explicit whitelist comparison: status === 'paid'.
```

**`AUDIT_REPORT.md §H3`** — это ссылка на полное описание бага. Открываешь документ, читаешь, исправляешь.

### 3.4. Как отключить guard для строки (false positive)

Добавь комментарий `// arch-guard: disable-next-line` + объяснение:

```ts
// arch-guard: disable-next-line G6 — legacy PSP returns compound status, refactor in PAY-127
const isPaid = status.includes('paid')
```

Без объяснения ревьюер отклонит PR.

### 3.5. Не пересекается с `ci.yml`

Это **отдельный** workflow. Не модифицирует `ci.yml`. Если твой `ci.yml` содержит `pnpm lint || true` или `pnpm test || true` — Tier 1 в нём по-прежнему подавлен, но **Tier 2 работает независимо**. Сделано намеренно, чтобы внедрение не ломало существующие процессы.

---

## 4. Что НЕ покрыто

Tier 1 + Tier 2 ловят **синтаксические** и **структурные** нарушения. Они **не ловят**:

| Тип | Почему | Что делать |
|-----|--------|-----------|
| **Логические баги** (off-by-one, race condition в конкретном use-case) | Невозможно выразить как grep/ESLint | Code review + тесты |
| **HMAC на raw body** (правильно ли настроен `bodyParser({verify})` в `main.ts`) | Слишком специфично для grep | G5 проверяет только "есть ли упоминание rawBody" |
| **Реальная безопасность** (CSRF в форме, IDOR) | Требует runtime analysis | Ручной pentest |
| **Качество тестов** (покрывают ли они edge cases) | Семантика, не синтаксис | Manual + mutation testing |

Для этих вещей — **нужен человек-ревьюер или AI-агент-ревьюер** (Tier 3, см. `AUDIT_REPORT.md §9 P3`).

---

## 5. Как добавить новый guard

Если нашёл повторяющееся нарушение, которого нет в списке:

1. Создай issue с label `guard-request`.
2. В issue опиши: что ищешь, почему ESLint не справляется, какой AUDIT-ID.
3. После одобрения — добавь шаг в `architecture-guards.yml` по шаблону существующих G1-G12.
4. Обнови таблицу в §3.2 этого документа.

---

## 6. История изменений

| Дата | Что | Кто |
|------|-----|-----|
| 2026-08-25 | Tier 1: warn → error + no-restricted-imports для prisma | AI agent (аудит) |
| 2026-08-25 | Tier 2: 12 grep-guards в architecture-guards.yml | AI agent (аудит) |
| 2026-08-25 | Документ QUALITY_GATES.md | AI agent (аудит) |

---

## 7. Связанные документы

- `docs/AUDIT_REPORT.md` — список всех 25 багов, маппинг на правила
- `docs/AI_DEVELOPMENT_RULES.md` — что **должен** соблюдать AI-агент (текст)
- `docs/SECURITY_BASELINE.md` — security правила (текст)
- `docs/CONVENTIONS.md` — code style (текст)
- `docs/IMPLEMENTATION_GAPS.md` — баги, не связанные с аудитом
- `.cursorrules` — правила для Cursor IDE
- `AGENTS.md` — bootstrap для AI-агентов
