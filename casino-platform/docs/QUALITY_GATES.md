---
title: Quality Gates
description: Как ESLint-strict и architecture-guards защищают casino-platform от регрессий
status: living document
audience: разработчики, AI-агенты, ревьюеры
last_updated: 2026-08-28
---

# Quality Gates

> **Зачем этот документ:** В проекте есть `docs/AI_DEVELOPMENT_RULES.md` (892 строки правил) и `docs/SECURITY_BASELINE.md`. Но текстовые правила LLM не применяет автоматически. Чтобы правила работали — они должны быть **выражены как код**: либо ESLint-правила, либо grep-скрипты в CI.
>
> Этот документ описывает Tier 1 + Tier 2 защиты, внедрённые 2026-08-25 как реакция на `docs/archive/audit-2026-08-25.md`. Tier 3 (AI-reviewer) не внедряется — каждый разработчик/агент читает правила **сам** через `AGENTS.md` + `AI_DEVELOPMENT_RULES.md`.

---

## 1. Сводка

| Tier         | Что                      | Где                                                                                                                              | Что ловит                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tier 1**   | ESLint (strict)          | `.eslintrc.js` + `--max-warnings=0` в lint-скриптах                                                                              | `any`, `console.log`, `parseFloat`, циклы модулей, длинные методы, прямые импорты prisma в domain/application. Падает и на **warnings**, не только на errors (GAP-39)                                                                                                                            |
| **Tier 2**   | Architecture guards (CI) | `.github/workflows/architecture-guards.yml`                                                                                      | 12 grep-проверок, которых ESLint не умеет: webhook raw body, Serializable в транзакциях, KYC fileFilter, Dockerfile USER, refresh-cookie secure, и т.д.                                                                                                                                          |
| **Tier 2.5** | Docs guards (CI)         | `.github/workflows/docs-guard.yml` (локально — `scripts/docs-guard-local.sh`, он же берёт тело шага и гоняет с флагами runner'а) | D1–D7: битые ссылки, существование путей в живых доках, env-parity (`.env.example` ↔ ENVIRONMENT_VARIABLES), честность SECURITY_CHECKLIST, drift машинных файлов, job-имена branch protection, **D7 — env-имена из кода (`process.env.*`, `config.get(...)`) описаны в `.env.example`** (GAP-41) |

**Эти два tier'а ловят ~80% нарушений из `docs/archive/audit-2026-08-25.md`** (25 найденных багов). Остальные 20% (HMAC на raw body в `main.ts`, конкретные баги в бизнес-логике) требуют **ручного code review** — их ESLint не поймает.

---

## 2. Tier 1: ESLint

### 2.1. Что ужесточено (warn → error)

Все эти правила были `warn` в предыдущей версии `.eslintrc.js`, что означало: lint warning ≠ CI fail. Теперь они **`error`** → CI красный, merge заблокирован.

> ✅ **2026-09-01: GAP-25 закрыт** — `max-params` и `complexity` доведены до обещанных
> error-порогов (3/10), весь `apps/api/src` чищен под них (45 + 13 нарушений разобраны).
> Исключения — framework-imposed сигнатуры Nest, см. §2.1.1. Остальные строки таблицы соответствуют коду.

| Правило                                                              | Было     | Стало                                     | Ловит в коде                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | -------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-console`                                                         | warn     | **error**                                 | `console.log` в production-коде (AUDIT §C2)                                                                                                                                                                                                                                                                                |
| `@typescript-eslint/no-explicit-any`                                 | warn     | **error**                                 | `any` тип (AUDIT §C5, в коде: `toMoney(n: any)`)                                                                                                                                                                                                                                                                           |
| `import/no-cycle`                                                    | warn     | **error**                                 | Циклы в модулях (скрытые баги зависимостей)                                                                                                                                                                                                                                                                                |
| `react-hooks/exhaustive-deps`                                        | warn     | **error**                                 | Stale closures (в React-коде)                                                                                                                                                                                                                                                                                              |
| `max-params` (3)                                                     | warn (4) | **error (3)** — GAP-25 закрыт 2026-09-01  | Функции с >3 параметрами                                                                                                                                                                                                                                                                                                   |
| `max-depth` (3)                                                      | warn     | **error**                                 | Вложенность >3                                                                                                                                                                                                                                                                                                             |
| `complexity` (10)                                                    | warn     | **error (10)** — GAP-25 закрыт 2026-09-01 | Cyclomatic complexity >10                                                                                                                                                                                                                                                                                                  |
| `max-lines-per-function` (**60**, `skipBlankLines` + `skipComments`) | warn     | **error**                                 | Методы длиннее 60 зачётных строк. История: порог поднимали до 90 под prettier-нормализацию (printWidth 100 растягивает строки) и **вернули к 60** в GAP-30 (2026-09-02) — строка этой таблицы вравила про «временно 90» ещё полтора дня, пока не упёрлась в GAP-48. Исключений нет ни одного, за этим следит guard **G14** |

### 2.1.1. Разрешённые исключения `max-params` (GAP-25)

⚠️ **Распространяется только на `max-params`.** Для `max-lines-per-function` исключений нет: inline
`eslint-disable` этого правила ловит guard **G14** (Tier 2) и роняет CI с указанием файла. Причина,
по которой это стоит зафиксировать: единственное такое подавление (`runDaily`, referrals) оказалось
не «осознанным исключением», а мёртвым грузом — на момент добавления метод имел 23 зачётные строки
при лимите 90, то есть правило не нарушал никогда (GAP-48). Длинный метод — сигнал о смешанной
ответственности: его надо разбить (как `dayBounds` / `processUserRewards` / `processCurrencyReward`),
а не выводить из-под порога.

Порог 3 — про **наш** API-дизайн (функция, принимающая 4+ позиционных аргумента, читается
плохо → нужен input-объект). Сигнатуры, которые навязывает фреймворк, рефакторить нельзя —
они вынесены явно и **только** так:

| Где                                          | Механизм                                                      | Почему                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**/*.controller.ts`, `**/src/main.ts`       | `overrides` → `max-params: off`                               | Числа параметров задаются декораторами `@Param/@Body/@Headers/@Res` и express-подписью `verify(req, res, buf, encoding)` — это контракт фреймворка, а не дизайн |
| DI-конструкторы сервисов/use-cases (10 мест) | inline `// eslint-disable-next-line max-params -- Nest DI: …` | Состав конструктора = граф зависимостей Nest; «объект-зависимость» ради порога означал бы ручной проброс каждого сервиса                                        |

Всё остальное (>3 параметров) переведено на input-объекты вместе с вызовами: `wallet`
`lock/unlock/confirmWithdrawal` → `WithdrawalOpArgs`, `kyc.setStatus`, `support`
`createTicket/listUserTickets/addMessage`, `referrals` `sumTransactions/findReward/processUserRewards`,
`casino` `findRoundsWithGame/findOrCreateRound/creditWin`, `notifications.list`,
`payment-request.listUser`, `favorites.history`, webhook-`execute` → `Process*WebhookInput`.

`complexity` исключений не имеет: 13 нарушений разобраны на приватные методы/таблицы
(`sniffDocumentMime` → `isJpeg/isPng/isWebp/isPdf`, `GlobalExceptionFilter` →
`payloadMessage/payloadCode/payloadDetails`, вебхуки → `resolvePaymentRequest/applyOutcome/applyPaymentStatus`,
GitSlotPark → `CALLBACK_MESSAGE_BUILDERS/firstPresent/mapProviderGame`,
`syncGames` → `upsertGameRow/gameSlug`, provider-callback → `dispatch`).

> `packages/*` и `apps/web`/`apps/admin` под `pnpm -r lint` не попадают по-разному:
> у `packages/*` lint-скрипта нет (гейт — `apps/api`: `eslint src test --ext .ts`), у фронтенда
> `next lint` + собственные overrides (`complexity: off` для `app/**`, `components/**`) —
> на 2026-09-01 обе точки дают 0 errors. С 2026-09-30 область линта — `src` **и** `test`
> (см. §2.4), раньше `test/` не линтировался ни одним гейтом.

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

⚠️ **Exit-code ESLint без `--max-warnings` отражает только errors.** Именно поэтому
GAP-39 жил при зелёном CI со `✖ 1171 problems (0 errors, 1171 warnings)`: правила стояли
в `warn`, а `warn` не ломал сборку. С 2026-09-03 порог закреплён машиной — во всех трёх
приложениях с `lint`-скриптом стоит `--max-warnings=0`:

| Приложение   | Скрипт                                            |
| ------------ | ------------------------------------------------- |
| `apps/api`   | `eslint src test --ext .ts --max-warnings=0`      |
| `apps/web`   | `next lint --dir src --dir test --max-warnings=0` |
| `apps/admin` | `next lint --dir src --dir test --max-warnings=0` |

До 2026-09-30 в скриптах был только `src`, и это расходилось с pre-commit: lint-staged
гоняет eslint по КАЖДОМУ staged-файлу, поэтому `test/` и `infra/load-tests` ловили ошибки
при коммите, но не в CI. Практическое следствие: слияние в `main` (merge-коммит тащит
чужие файлы) падало на хуке, а rebase — нет; синхронизироваться с `main` приходилось
rebase-ом. Теперь область совпадает, и расхождения тому нет:

- тестовые overrides (§11 в `docs/CONVENTIONS.md`) живут в корневом `.eslintrc.js`
  (`**/*.spec.ts(x)`, `**/*.test.ts(x)`, `**/*.e2e-spec.ts`) и в `apps/api/.eslintrc.js`
  (`test/**/*.ts`): размер функции/параметры/complexity и `no-explicit-any` + `unsafe-*`
  для моков выключены, `import/order`, `no-unused-vars`, `no-floating-promises`,
  `consistent-type-imports` остаются `error`;
- деньги в тестах: money-селектор `no-restricted-syntax` покрывает и ключ `total`, а в
  спеках `total` — счётчик пагинации из конверта `{items, meta}`. Для тестов тот же
  селектор объявлен без `total` (число как деньги по-прежнему `error`), в `src` — без
  изменений;
- `infra/load-tests/**/*.js` (k6): globals `__ENV`/`__VU`/`__ITER`, `import/no-unresolved`
  выключен (модулей `k6/*` нет в node_modules), `max-params` выключен — сигнатура билдера
  подписи повторяет порядок полей провайдера (GAP-43).

С 2026-10-01 та же область у typecheck-гейта: `apps/api` проверяется `tsc --noEmit -p
tsconfig.eslint.json` (src + test + сам `.eslintrc.js`), а не `tsconfig.json` (только `src`).
Причина расхождения была в `apps/api/tsconfig.json`: `include: ["src"]`,
`exclude: [..., "test"]` — 49 ошибок типизации в `test/` не видел ни один гейт, хотя
`apps/web` и `apps/admin` свои спеки типизируют (у них `include: ["**/*.ts", "**/*.tsx"]`).
`tsconfig.eslint.json` уже покрывал `src`+`test` для type-aware правил ESLint, поэтому
typecheck переведён на него, а не заведён третий конфиг.

Форма с `=` (а не `--max-warnings 0`) выбрана намеренно: у `next lint` аргумент объявлен
как необязательный (`[maxWarnings]`), а `0` для ESLint — falsy, так что `=` убирает обе
вольности трактовки. По коду Next проверка такая: `isError = errors > 0 || (maxWarnings >= 0
&& totalWarnings > maxWarnings)` — то есть `0` обрабатывается корректно (сравнение `>= 0`,
не truthiness). Проверено на установленном `next@14.2.35`.

Чтобы порог не «испарился» от обратной правки скриптов, его сторожит guard **G13**
(`.github/workflows/architecture-guards.yml`): отсутствие `--max-warnings=0` хотя бы в одном
из трёх `package.json` — падение Tier 2. Список warnings локально по-прежнему видно: ESLint
печатает отчёт до выхода с кодом 1; для автофикса — `pnpm lint --fix`.

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
- Если нашёл — fail с сообщением, в котором указан ID бага из docs/archive/audit-2026-08-25.md

Эти проверки **нельзя** выразить через ESLint (например, "есть ли в `main.ts` `rawBody`?", "есть ли в каждом `*.Dockerfile` директива `USER`?").

### 3.2. Список проверок

| #   | ID                                 | Что проверяет                                                                                                       | AUDIT §           | Severity |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- | -------- |
| G1  | no prisma in domain/application    | grep `from '@casino/database'` в domain/ и application/                                                             | A3, A4, H5        | 🔴       |
| G2  | no @ts-ignore / @ts-nocheck        | grep в src, исключая тесты                                                                                          | C1                | 🟠       |
| G3  | no console.log in api              | grep `console.log(`                                                                                                 | C2                | 🟠       |
| G4  | no `@Body() any`                   | grep в controllers                                                                                                  | C3, N8, N9        | 🔴       |
| G5  | webhook raw body                   | если есть webhook controller, в main.ts должен быть `rawBody`                                                       | N5                | 🔴       |
| G6  | no `status.includes` in payments   | grep `status.includes` в payments                                                                                   | H3                | 🔴       |
| G7  | wallet ops use Serializable        | подсчёт `$transaction` vs `Serializable`                                                                            | H1                | 🔴       |
| G8  | KYC upload has fileFilter          | если есть FileInterceptor, должен быть fileFilter                                                                   | N6                | 🔴       |
| G9  | refresh cookie secure conditional  | grep `secure: false` в auth                                                                                         | N7                | 🔴       |
| G10 | Dockerfile USER directive          | каждый `*.Dockerfile` имеет `USER`                                                                                  | N11               | 🔴       |
| G11 | env.example short placeholders     | grep длинных `dev_*_REPLACE_WITH`                                                                                   | N10               | 🟠       |
| G12 | branch name convention             | PR branch начинается с `feat/`, `fix/` и т.д.                                                                       | CONVENTIONS §10.1 | 🟡       |
| G22 | Nest DI tokens declared explicitly | `node scripts/check-explicit-di.mjs` — у каждого внедряемого параметра конструктора провайдера есть `@Inject(Token` | ARCHITECTURE §5.3 | 🔴       |
| G23 | NEXT_PUBLIC_ args reach prod builds | `sh scripts/check-prod-build-args.sh` — каждый `ARG` (кроме `_*`) из `*.prod.Dockerfile` передан сервису через `build.args` | ENVIRONMENT_VARIABLES §NEXT_PUBLIC_*, TZ ч.7 | 🔴       |

> Таблица перечисляет проверки с момента появления Tier 2; G13–G21 заведены позже и
> зарегистрированы только в `.github/workflows/architecture-guards.yml` и в §6 этой истории
> (строки 2026-09-04 и новее) — единый источник правды по ним: workflow.

### 3.3. Как читать лог

Если CI красный, в логе будет:

```
❌ G6 FAIL: string-match on payment status is unsafe:
apps/api/src/modules/payments/application/use-cases/process-rukassa-webhook.use-case.ts:34:  const success = ['paid','success','completed','confirm'].some(s => status.includes(s))
   See docs/archive/audit-2026-08-25.md §H3.
   'status.includes("paid")' matches 'unpaid', 'prepaid', etc.
   Use explicit whitelist comparison: status === 'paid'.
```

**`docs/archive/audit-2026-08-25.md §H3`** — это ссылка на полное описание бага. Открываешь документ, читаешь, исправляешь.

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

| Тип                                                                             | Почему                                          | Что делать                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| **Логические баги** (off-by-one, race condition в конкретном use-case)          | Невозможно выразить как grep/ESLint             | Code review + тесты                              |
| **HMAC на raw body** (правильно ли настроен `bodyParser({verify})` в `main.ts`) | Слишком специфично для grep                     | G5 проверяет только "есть ли упоминание rawBody" |
| **Реальная безопасность** (CSRF в форме, IDOR)                                  | Требует runtime analysis                        | Ручной pentest                                   |
| **Качество тестов** (покрывают ли они edge cases)                               | Семантика, не синтаксис                         | Manual + mutation testing                        |
| **Сообщение squash-коммита на `main`**                                          | Его пишет GitHub, хук `commit-msg` его не видит | Прогнать текст через `commitlint` до мержа       |

Для этих вещей — **нужен человек-ревьюер или AI-агент-ревьюер** (Tier 3, см. `docs/archive/audit-2026-08-25.md §9 P3`).

**Сообщение squash-коммита проверяется до отправки, а не после.** Мерж через API/GUI создаёт
коммит на `main` сам — локальный хук `commit-msg` в этой цепи не участвует, а CI-джоб
`commitlint` на push берёт диапазон `event.before..HEAD` и видит только что созданный коммит.
Нарушение всплывает уже на `main` (проверено на `body-max-line-length` = 200: длинный буллет
сделал main красным и снял с запуска `Deploy to VPS`). Перед мержем:

```sh
printf '%s' "$COMMIT_MESSAGE" | pnpm exec commitlint   # header ≤ 100, строка body ≤ 200
```

Там же — причина, по которой payload для API не собирают через `node -e "…"` в двойных
кавычках: bash съедает backticks и `$…` внутри строки, и в сообщении остаётся дыра вместо
целой строки. Payload — файлом, отправка — `@payload.json`.

---

## 5. Как добавить новый guard

Если нашёл повторяющееся нарушение, которого нет в списке:

1. Создай issue с label `guard-request`.
2. В issue опиши: что ищешь, почему ESLint не справляется, какой AUDIT-ID.
3. После одобрения — добавь шаг в `architecture-guards.yml` по шаблону существующих G1-G12.
4. Обнови таблицу в §3.2 этого документа.

---

## 6. История изменений

| Дата       | Что                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Кто                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 2026-08-25 | Tier 1: warn → error + no-restricted-imports для prisma                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | AI agent (аудит)                       |
| 2026-08-25 | Tier 2: 12 grep-guards в architecture-guards.yml                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | AI agent (аудит)                       |
| 2026-08-25 | Документ QUALITY_GATES.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | AI agent (аудит)                       |
| 2026-08-28 | Ссылки на аудит → `docs/archive/audit-2026-08-25.md`; честный статус max-params/complexity (GAP-25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | AI agent (фаза 1: единый статус)       |
| 2026-08-28 | Tier 2.5: `docs-guard.yml` (D1–D6) + PR-шаблон с docs-чеклистом                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | AI agent (фаза 3: автопроверка)        |
| 2026-08-28 | PR-0: typecheck-конфиг починен (rootDir/tsconfig.build.json, пакеты → dist), тесты переписаны на vitest (18/18), lint 0 ошибок, `max-lines-per-function` 60→90 (GAP-30)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | AI agent (PR-0: ликвидация долга CI)   |
| 2026-09-01 | GAP-25 закрыт: `max-params` error(3) + `complexity` error(10), разобраны 45 + 13 нарушений, §2.1.1 (исключения Nest); GAP-26 закрыт: 72 глубоких относительных импорта → `@/`+`@modules/`, билд через `tsc-alias`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | AI agent (GAP-25/26)                   |
| 2026-09-03 | Tier 1: порог «0 warnings» закреплён машиной — `--max-warnings=0` в lint-скриптах `api`/`web`/`admin` + guard **G13** (Tier 2), который не даёт убрать флаг. До этого `pnpm lint` возвращал 0 и при 1171 warnings — так GAP-39 числился «зелёным» до 2026-09-02                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | AI agent (закрепление GAP-39)          |
| 2026-09-03 | GAP-41 закрыт: **Tier 2.5 += D7** (код ↔ `.env.example`) — закрывает слепое пятно D3 (сверяет `.env.example` ↔ §22, но не код); в `.env.example`/ENVIRONMENT_VARIABLES добавлены `GITSLOTPARK_*` (4) и `RUKASSA_API_BASE`; allowlist D7: `NODE_ENV`, `CI`, `*_INTEGRATION`, `E2E_*`, `SMTP_PASS` (до мержа GAP-40). **Попутно:** шаг CI выполняется под `bash -e -o pipefail` — извлечение-в-файл с пустым `grep` убивало guard молча, D3/D6/D7 защищены (`\|\| true`, явный ❌ D6); добавлен `scripts/docs-guard-local.sh` (локальный прогон чеков СВОЕЙ ветки с флагами runner'а, вместо ручной копии в `$HOME`)                                                                                                                                                                                                                                                                                                                                                                                                                                         | AI agent (GAP-41)                      |
| 2026-09-04 | Guard **G14** (Tier 2): любой `eslint-disable` для `max-lines-per-function` роняет CI — закрепляет закрытие GAP-48 (само подавление снято в PR #63). Попутно: строка §2.1 вралила про порог («временно 90», хотя GAP-30 вернул 60 ещё 2026-09-02) — исправлена; §2.1.1 явно ограничен `max-params` (раньше текст читался как лицензия на любые обходы); зарегистрирован **GAP-51** — три TODO в коде ссылались на закрытый GAP-22, из-за чего неотрекенный долг выглядел исполненным                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | AI agent (GAP-48 / GAP-51)             |
| 2026-09-30 | Тулчейн переезжает на нативную сборку: `typescript` → `npm:@typescript/typescript6@6`, `@typescript/native` → `npm:typescript@7` (`tsgo`), typescript-eslint → 8. С типизированными правилами ESLint впервые проверяет `apps/api/src` целиком — после sweep'а 0 ошибок/0 warnings. Цена переезда: `emitDecoratorMetadata: false` (tsgo его не эмитит) ломает implicit-DI в Nest, поэтому конструкторы переведены на явный `@Inject(Token)`, правило зафиксировано в `docs/AI_DEVELOPMENT_RULES.md` §3.2. **Tier 1 +=** `fileParallelism: false` в `apps/api/vitest.config.ts`: интеграционные спеки на Serializable-транзакциях флакали при параллельных файлах-воркерах (см. PR #100/#102/#104). **Попутно:** `apps/api/src` лежал рассортированным шире `printWidth: 100`, так что prettier из pre-commit хука переносит строки в каждом затрагиваемом файле; 9 методов из-за этого перешагнули `max-lines-per-function` и приведены в порядок выносом длинных return-типов в алиасы и приватные хелперы (inline-подавление запрещено G14)               | AI agent (миграция TS 6/7-native)      |
| 2026-10-01 | Guard **G23** (Tier 2): `sh scripts/check-prod-build-args.sh` роняет CI, если `*.prod.Dockerfile` объявляет `ARG`, а сервис в `docker-compose.prod.yml` не передаёт его в `build.args`. Причина — GAP-59: `NEXT_PUBLIC_API_URL` был build-arg только у `web`, у `admin` не было — Next.js инлайнит `NEXT_PUBLIC_*` в бандл на сборке, `env_file` на build не влияет, поэтому бандл админки запекал домен-плейсхолдер `casino.example.com` и на реальном домене уходил на чужой хост (vhost admin в nginx без `location /api/`, axios `'use client'` с абсолютным baseURL). Эмпирика: две сборки одного кода дали разные литералы в `.next/static/chunks/**`. CI не ловил — job `docker-build` собирает только `api.prod` | AI agent (полная проверка проекта, GAP-59) |
| 2026-09-30 | Guard **G22** (Tier 2): `node scripts/check-explicit-di.mjs` роняет CI, если у внедряемого параметра конструктора Nest-провайдера нет `@Inject(Token)`. После переезда на `emitDecoratorMetadata: false` такой код собирается, проходит `tsc` и ESLint, приложение стартует — и падает в первом же обращении. Причину нашёл не гард, а E2E player-lifecycle: `AuthController` с десятью неявными зависимостями ломал регистрацию и логин (HTTP 500); unit-спеки этого не ловят (DI контроллера в них не проверяется), как и `boot`-проверка `/health`. Тем же симптомом были закрыты `ProviderCallbackController` (колбэки провайдера) и `PaymentsWebhookController` (вебхуки платежей)                                                                                                                                                                                                                                                                                                                                                                    | AI agent (миграция TS 6/7-native, G22) |
| 2026-09-30 | Область линта = область кода: `eslint src test` в `apps/api`, `next lint --dir src --dir test` в `apps/web` и `apps/admin` (скрипты §2.4). До этого `test/` линтировал только pre-commit (lint-staged по staged-файлам), из-за чего merge-ом в `main` дерево нельзя было коммитить, а CI оставался зелёным. Долг снят на месте: 15 нарушений в `apps/api/test` (import/order, мёртвые переменные, `require()`, `no-extra-semi`, лишние `?.`), 13 — в `infra/load-tests/wallet-concurrency.js`, 3 — во фронтенд-спеках. Тестовые overrides приведены к конвенции §11 (`.tsx` спеки больше не считаются по «взрослым» лимитам, money-селектор в тестах не бьёт по пагинационному `total`). **Известный остаток:** `pnpm typecheck` по-прежнему только `src`; `tsc -p apps/api/tsconfig.eslint.json` даёт 49 ошибок в 12 файлах `test/` — это отдельная работа, а не регресс этого change                                                                                                                                                                     | AI agent (линт тестов)                 |
| 2026-10-01 | Остаток из строки выше закрыт: `apps/api` typecheck = `tsc --noEmit -p tsconfig.eslint.json` (src + test + `.eslintrc.js`), 49 ошибок в `test/` разобраны. Настоящих дефектов четыре: спек импортировал неэкспортируемый `CatalogQuery` (и `as CatalogQuery` маскировал лишние поля); `verifyIPN` вызывался распарсенным объектом там, где контракт порта — сырой текст тела; тест «без ключей → fail-closed» подсовывал `undefined` в мок-конфиг, где `??` молча возвращал настоящие ключи, то есть проверялась подпись, а не отсутствие ключей (теперь ключей нет реально, а вход берётся из `buildSignedBody` — при настроенных ключах он дал бы `true`); top-level `await import('crypto')` в CJS-компиляции. Остальное — честная типизация моков: контракт входа выводится из сигнатуры use-case (`Parameters<…>`), `$transaction` описан нужной колбэк-веткой вместо prisma-перегрузок, индексы массивов проверены явно (`noUncheckedIndexedAccess`). Фронтенд не тронут: `apps/web`/`apps/admin` типизируют `test/` давно (`include: ["**/*.ts*"]`) | AI agent (typecheck тестов)            |
| 2026-10-01 | §4 += строка и разбор: **сообщение squash-коммита не проходит через `commit-msg`** — его пишет GitHub, а CI-джоб `commitlint` на push в `main` смотрит только на свежий коммит. Проверено на собственном мерже `e5a2fa5` (#115): буллет длиннее 200 символов → `body-max-line-length` → main красный, `Deploy to VPS` не запустился. Добавлена команда предпроверки (`printf '%s' "$MSG" \| pnpm exec commitlint`) и правило не собирать API-payload через `node -e "…"` в двойных кавычках (bash съедает backticks — в теле коммита осталась дыра вместо первой строки)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | AI agent (механика мержа)              |
| 2026-10-01 | **Tier 0 += `scripts/bin/check-staged-paths`** в `pre-commit` (перед `lint-staged`): denylist staged-путей — картинки в корне репо, `*.log`, `*.tmp.txt/json/log`, `zz-*`, `only-mine.txt`, `cl-out.txt`, `.vite/`, `.wt-*`, каталоги агентов. Причина: в индексе одного дерева оказалось 33 staged-пути, из них 24 мусор (16 скриншотов, gitlink `.wt-g21`), и их можно было закоммитить. Игнор от этого не спасает — `git add -f`, уже отслеживаемый файл и свежий клон без `.git/info/exclude` возвращают мусор, поэтому правило продублировано в `.gitignore`. Проверено на живом индексе: 24/24 мусорных пути, 0 ложных срабатываний на 699 tracked-файлах. Обход — `ALLOW_SCRATCH_COMMIT=1` с предупреждением, а не `--no-verify`; подсказка про `--no-verify` из текста secret-scan убрана.                                                                                                                                                                                                                                                         | AI agent (консолидация деревьев)       |

---

## 7. Связанные документы

- `docs/archive/audit-2026-08-25.md` — список всех 25 багов, маппинг на правила
- `docs/AI_DEVELOPMENT_RULES.md` — что **должен** соблюдать AI-агент (текст)
- `docs/SECURITY_BASELINE.md` — security правила (текст)
- `docs/CONVENTIONS.md` — code style (текст)
- `docs/IMPLEMENTATION_GAPS.md` — баги, не связанные с аудитом
- `.cursorrules` — правила для Cursor IDE
- `AGENTS.md` — bootstrap для AI-агентов
