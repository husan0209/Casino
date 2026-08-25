---
title: Audit Report
description: Технический аудит casino-platform — баги, уязвимости, нарушения конвенций
status: living document
audience: AI agents, tech lead, code reviewers
last_updated: 2026-08-25
---

# Audit Report — casino-platform

> **Дата аудита:** 2026-08-25
> **Аудитор:** AI-агент (второй проход, после прочтения `AGENTS.md`, `.cursorrules`, `docs/AI_DEVELOPMENT_RULES.md`, `docs/SECURITY_BASELINE.md`, `docs/SECURITY_CHECKLIST.md`, `docs/CONVENTIONS.md`, `docs/API_CONVENTIONS.md`, `docs/ARCHITECTURE.md`, `docs/STACK.md`, `docs/IMPLEMENTATION_GAPS.md`, `docs/QA_CHECKLIST.md`)
> **Скоуп:** весь монорепо (`apps/api`, `apps/web`, `apps/admin`, `packages/*`, `infra/`, `.github/`)
> **Метод:** статический анализ кода + сверка с мастер-документами проекта

> **Принцип:** этот документ — **только факты и ссылки на источник**. Без рекомендаций «как чинить» (это → в IMPLEMENTATION_GAPS.md или issue). Без фантазий: каждый баг проверен по коду, каждое нарушение — по конкретному правилу из конкретного документа.

---

## 0. Сводка

| Категория | Кол-во | Уровень |
|-----------|--------|---------|
| 🔴 CRITICAL — деньги / безопасность | 12 | блокер для prod |
| 🟠 HIGH — нарушения архитектуры / денег | 7 | должен быть закрыт до MVP |
| 🟡 MEDIUM — нарушения конвенций / стиля | 6 | технический долг |
| 📜 Документы ↔ реальность | 5+ | SECURITY_CHECKLIST лжёт |
| 🛡 Уровней защиты от плохого кода работает | 1.5 из 5 | процессная дыра |

**Общая оценка:** 4/10. Документация и архитектурный замысел — сильные (9/10), но реальная защита кода и реализация ключевых baseline-требований — слабые (3/10).

---

## 1. 🔴 CRITICAL — деньги и безопасность

### N1. Пароль без требований сложности
- **Файл:** `apps/api/src/modules/auth/presentation/dto/register.dto.ts:4`
- **Код:** `password: z.string().min(8)`
- **Нарушает:** `docs/SECURITY_BASELINE.md §2.2` — «Минимум 8 символов, минимум 1 цифра»
- **Риск:** перебор топ-10000 паролей; 8 символов только букв = 26⁸ ≈ 2·10¹¹ вариантов, но словарные слова — секунды

### N2. Нет account lockout после N неудачных логинов
- **Файл:** `apps/api/src/modules/auth/application/use-cases/login.use-case.ts` (весь файл)
- **Код:** нет инкремента `failed_login_attempts`, нет `locked_until`
- **Нарушает:** `docs/SECURITY_BASELINE.md §2.3` — «После 10 неудачных login за 15 минут — блокировка на 30 минут»
- **Риск:** неограниченный online brute-force

### N3. Нет ThrottlerModule (rate-limit на уровне приложения)
- **Файл:** `apps/api/src/app.module.ts` (отсутствует импорт)
- **Код:** `@nestjs/throttler` не установлен, в `package.json` нет
- **Нарушает:** `docs/SECURITY_BASELINE.md §4.2` — «App-level (ThrottlerModule) ОБЯЗАТЕЛЬНО»
- **Риск:** nginx rate-limit обходится прямым доступом к api:3001 (если не закрыт firewall) или подделкой X-Forwarded-For

### N4. Нет helmet() middleware
- **Файл:** `apps/api/src/main.ts` (отсутствует `app.use(helmet(...))`)
- **Код:** `helmet` не установлен, в `package.json` нет
- **Нарушает:** `docs/SECURITY_BASELINE.md §6.3` — Helmet обязателен
- **Риск:** при прямом доступе к api (минуя nginx) — нет security headers

### N5. HMAC webhook'ов не на raw body
- **Файлы:** `apps/api/src/modules/payments/presentation/controllers/payments-webhook.controller.ts`, `apps/api/src/main.ts`, `apps/api/src/modules/payments/infrastructure/clients/rukassa.client.ts`, `…/nowpayments.client.ts`
- **Код:** `main.ts` не настраивает `bodyParser({ verify: (req, res, buf) => { req.rawBody = buf } })`. Контроллер передаёт `@Body() body: any` (re-serialised JSON) в `verifyCallback()`. HMAC считается на объект, а не на байты
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §8` — «ВСЕГДА сохранять raw callback в БД ДО обработки» (raw body для HMAC); `docs/SECURITY_BASELINE.md §8.1` — пример HMAC на `payload: string` (raw)
- **Риск:** подмена подписи при различиях JSON-сериализации (порядок ключей, пробелы, unicode)

### N6. KYC upload без fileFilter / magic bytes
- **Файл:** `apps/api/src/modules/kyc/presentation/controllers/kyc.controller.ts:32-37`
- **Код:** `@UseInterceptors(FileInterceptor('file', { storage: diskStorage(...), limits: { fileSize: 10MB } }))` — нет `fileFilter` по MIME, имя файла = `randomUUID() + extname(f.originalname)`
- **Нарушает:** `docs/SECURITY_BASELINE.md §7.1` (whitelist MIME), §7.3 (magic bytes), §13 (KYC хранение)
- **Риск:** загрузка `.html` с JS, `.svg` с `<script>`, polyglot-файлов → XSS / RCE если файл потом отдаётся

### N7. Refresh-token cookie: secure:false hardcoded
- **Файл:** `apps/api/src/modules/auth/presentation/controllers/auth.controller.ts:30,41,51,65,78,89`
- **Код:** `res.cookie('refresh_token', result.refreshToken, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: ... })` — `secure: false` **в 6 местах**, не зависит от `NODE_ENV`
- **Нарушает:** `docs/SECURITY_BASELINE.md §5.1` — для cookie auth нужен `secure: true` в production
- **Риск:** в production MITM по HTTP угонит refresh-token → полная компрометация сессии

### N8. /forgot-password без Zod-валидации
- **Файл:** `apps/api/src/modules/auth/presentation/controllers/auth.controller.ts:62-64`
- **Код:** `@Post('forgot-password') async forgot(@Body() body: { email: string })` — `body: any` без `@UsePipes(ZodValidationPipe)`
- **Нарушает:** `docs/SECURITY_BASELINE.md §9.1` — Whitelisting через ValidationPipe обязателен; `docs/API_CONVENTIONS.md §2` — формат body
- **Риск:** отсутствие валидации формата email → DoS / log poisoning

### N9. /deposit/crypto, /withdrawal/* без Zod-валидации
- **Файл:** `apps/api/src/modules/payments/presentation/controllers/payments.controller.ts:35-49`
- **Код:** `@Post('deposit/crypto') depositCrypto(@CurrentUser() u, @Body() b: ...)` — нет `@UsePipes`. `/withdrawal/fiat`, `/withdrawal/crypto` — `@Body() b: any`
- **Нарушает:** `docs/SECURITY_BASELINE.md §9.1`, `docs/AI_DEVELOPMENT_RULES.md §12` чеклист «Все inputs валидируются»
- **Риск:** negative amount, невалидный destination, type confusion → нельзя гарантировать idempotency

### N10. JWT secrets не проверяются на unsafe-patterns в production
- **Файл:** `packages/shared-config/src/env.validation.ts`
- **Код:** `superRefine` проверяет `RUKASSA_SECRET_KEY` и `NOWPAYMENTS_IPN_SECRET` через `isUnsafeSecret`, но **не** `JWT_ACCESS_SECRET` и `JWT_REFRESH_SECRET`
- **Нарушает:** `docs/ENVIRONMENT_VARIABLES.md §10.1`, `docs/SECURITY_BASELINE.md §10.1` (Secrets Management)
- **Риск:** запуск production с `dev_access_secret_REPLACE_WITH_64_CHARS_RANDOM_STRING_FOR_PRODUCTION_USE_` (ровно 64 символа, проходит `z.string().min(64)`) → предсказуемый JWT secret

### N11. Docker контейнеры работают от root
- **Файлы:** `infra/docker/api.prod.Dockerfile`, `infra/docker/api.Dockerfile`, `infra/docker/web.prod.Dockerfile`, `infra/docker/web.Dockerfile`, `infra/docker/admin.prod.Dockerfile`, `infra/docker/admin.Dockerfile`
- **Код:** ни в одном Dockerfile нет `USER node` (или другого non-root пользователя)
- **Нарушает:** `docs/SECURITY_CHECKLIST.md §Infra: [x] Docker non-root`
- **Риск:** RCE через уязвимость в Node.js = root внутри контейнера

### N12. GlobalExceptionFilter передаёт массив в errorResponse как details
- **Файл:** `apps/api/src/common/filters/global-exception.filter.ts:13-14`
- **Код:** `return errorResponse(res.error || 'HTTP_ERROR', res.message || exception.message, ...)` — при Nest validation pipe `res.message` это `string[]` (массив ошибок), `errorResponse` ожидает `details?: Record<string, unknown>`
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §5.5` (пример правильного filter'а), `docs/CONVENTIONS.md §1.3` (без `any`, без обхода типов)
- **Риск:** невалидный JSON-API response (тип `details: any[]` вместо `Record`), потенциальный фронт-краш

---

## 2. 🟠 HIGH — деньги / архитектура

### H1. wallet.lock не использует Serializable + нет optimistic-lock retry
- **Файл:** `apps/api/src/modules/wallet/infrastructure/repositories/wallet.prisma.ts` (метод `lock`)
- **Код:** `return prisma.$transaction(async (tx) => { ... })` — без `{ isolationLevel: 'Serializable' }`, без retry-loop на `OptimisticLockError`
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §7.2` (паттерн с Serializable + retry до 3)
- **Риск:** race condition при двух одновременных `lock()` — double-spend

### H2. wallet.unlock не валидирует `newLocked >= 0`
- **Файл:** `apps/api/src/modules/wallet/infrastructure/repositories/wallet.prisma.ts` (метод `unlock`)
- **Код:** `const newLocked = money.subtract(toMoney(wallet.locked), amount)` → `tx.walletAccount.update({ data: { locked: newLocked, ... } })` — без проверки
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §1` (точность денег), §7 (транзакции)
- **Риск:** отрицательный `locked` → отрицательный `available` → bypass `InsufficientFundsError`

### H3. status matching в Rukassa webhook: `status.includes('paid')`
- **Файл:** `apps/api/src/modules/payments/application/use-cases/process-rukassa-webhook.use-case.ts:34`
- **Код:** `const success = ['paid','success','completed','confirm'].some(s => status.includes(s))`
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §8.2` (явный whitelist статусов)
- **Риск:** `'unpaid'`, `'prepaid'`, `'expired_payment'` совпадут с `paid` → ложный credit кошелька

### H4. Idempotency key для deposit = `deposit_${pr.id}` вместо `dep_${external_id}`
- **Файл:** `apps/api/src/modules/payments/application/use-cases/process-rukassa-webhook.use-case.ts:42`
- **Код:** `idempotencyKey: 'deposit_' + pr.id`
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §2.3` — формат: `dep_{payment_request.id}` (тут ок по формату), **но** §2.1: «Webhooks от payment-провайдеров могут приходить 2+ раз с одинаковым payload» — нужна защита и по `external_id` тоже
- **Риск:** при изменении payment_request (теоретически) старый ключ перестаёт защищать

### H5. Use-case лезет в prisma напрямую, минуя Repository
- **Файл:** `apps/api/src/modules/auth/application/use-cases/login.use-case.ts:25`
- **Код:** `const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } })`
- **Нарушает:** `.cursorrules` §"Cross-module communication" + `docs/AI_DEVELOPMENT_RULES.md §3.2` (слой application не должен импортировать infrastructure напрямую)
- **Риск:** обход архитектурных границ → дальнейший технический долг

### H6. Pino не подключён (везде Nest Logger)
- **Файлы:** все `*.use-case.ts`, `*.service.ts` (более 20 мест)
- **Код:** `import { Injectable, Logger } from '@nestjs/common'; private logger = new Logger(...)` — должен быть `pino` с `redact`
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §6.4` (Pino redact), `docs/CONVENTIONS.md §7` (структурированный JSON через pino)
- **Риск:** пароли / токены / карты могут быть залогированы (`SECURITY_BASELINE.md §12.1`)

### H7. Request-Id middleware не валидирует header
- **Файл:** `apps/api/src/common/middleware/request-id.middleware.ts:8`
- **Код:** `const id = (req.headers['x-request-id'] as string) || randomUUID()` — без whitelist regex
- **Нарушает:** общие best-practices (нет в явном виде в документах, но следует из §12.2 `SECURITY_BASELINE.md` masking + §6 логирования)
- **Риск:** log injection (CRLF, спецсимволы) + подмена id в ответе клиента

---

## 3. 🟡 MEDIUM — конвенции и стиль

### C1. `@ts-ignore` в production-коде
- **Файл:** `apps/api/src/main.ts:4`
- **Код:** `// @ts-ignore\nimport cookieParser from 'cookie-parser'`
- **Нарушает:** `docs/CONVENTIONS.md §1.3` — запрещено

### C2. `console.log` в production-коде
- **Файл:** `apps/api/src/main.ts:13`
- **Код:** `console.log(\`API listening on http://localhost:${port}/api/v1\`)`
- **Нарушает:** `.eslintrc.js` rule `no-console: ['warn', { allow: ['warn', 'error'] }]`; `docs/CONVENTIONS.md §7` (Pino)

### C3. `@Body() b: any` без Zod
- **Файлы:** `auth.controller.ts:62,64`, `payments.controller.ts:36,40,43,47`, `users` controller (вероятно), `support` controller (вероятно)
- **Нарушает:** `docs/API_CONVENTIONS.md §2`, `docs/SECURITY_BASELINE.md §9.1`

### C4. Относительные импорты `../../../../` вместо `@modules/*`
- **Файлы:** десятки контроллеров и use-case'ов
- **Код:** `import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'`
- **Нарушает:** `docs/CONVENTIONS.md §3.1` — Path aliases обязательны

### C5. `toMoney(n: any)` обход типизации
- **Файл:** `apps/api/src/modules/wallet/infrastructure/repositories/wallet.prisma.ts:9`
- **Код:** `function toMoney(n: any): MoneyAmount { return n.toString() }` — `any` на деньгах
- **Нарушает:** `docs/CONVENTIONS.md §1.3` (запрет any), `docs/AI_DEVELOPMENT_RULES.md §1` (точность денег)

### C6. Метод превышает 30 строк
- **Файл:** `apps/api/src/modules/wallet/infrastructure/repositories/wallet.prisma.ts` метод `runCreditDebit` (~50 строк)
- **Нарушает:** `docs/CONVENTIONS.md §4.3` — max 30 строк

---

## 4. 🟠 Архитектурные нарушения

### A1. wallet module без `application/use-cases/`
- **Файл:** `apps/api/src/modules/wallet/`
- **Код:** есть `application/wallet.facade.ts`, но **нет** `application/use-cases/`
- **Нарушает:** `.cursorrules` §"Module structure (CRITICAL)" — «EVERY backend module has this EXACT 4-layer layout» (включая `application/use-cases/`)
- **Следствие:** `lock/unlock/confirmWithdrawal` живут прямо в `infrastructure/repositories/wallet.prisma.ts` — смешение application и infrastructure

### A2. wallet.facade: динамический import в hot path
- **Файл:** `apps/api/src/modules/wallet/application/wallet.facade.ts:30`
- **Код:** `const { money } = await import('@casino/shared-utils')` внутри метода `getBalance`
- **Нарушает:** обычный code style + замедляет hot path; не соответствует `docs/CONVENTIONS.md §3.1`

### A3. process-rukassa-webhook пишет в БД напрямую через prisma
- **Файл:** `apps/api/src/modules/payments/application/use-cases/process-rukassa-webhook.use-case.ts:13`
- **Код:** `await this.repo.saveCallback(...)` — repository уже есть, но use-case не использует интерфейс `IPaymentRequestRepository` полностью (надо проверить, что именно инжектится)
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §3.3` (бизнес-логика только в use-case, repository — только доступ к БД)

### A4. process-rukassa-webhook — межмодульная зависимость через prisma
- **Файл:** `apps/api/src/modules/payments/application/use-cases/process-rukassa-webhook.use-case.ts:15`
- **Код:** `private users: UsersFacade` — ок через facade, **но** `process-nowpayments-webhook.use-case.ts` (надо проверить) — если тоже `users: UsersFacade`, это правильно
- **Статус:** подтверждено для Rukassa, требует ревью NOWPayments

### A5. tests = 2 файла на всё монорепо
- **Файлы:** `apps/api/test/env-validation.spec.ts`, `apps/api/test/provider-stubs.spec.ts`
- **Код:** `find . -name "*.spec.ts" -o -name "*.test.ts" | wc -l = 2` (без `node_modules`)
- **Нарушает:** `docs/AI_DEVELOPMENT_RULES.md §10` — «EVERY Service/Use Case MUST have unit tests», §10.3 таблица critical tests

### A6. `pnpm test` в CI запускает почти ничего
- **Файл:** `.github/workflows/ci.yml` job `quality`
- **Код:** `pnpm test` — пробегает по 2 spec-файлам, проходит за <1 сек
- **Риск:** даёт ложное «зелёное» ощущение покрытия

### A7. ESLint правила с severity `warn` не блокируют
- **Файл:** `casino-platform/.eslintrc.js`
- **Код:** `'@typescript-eslint/no-explicit-any': 'warn'`, `'complexity': ['warn', 10]`, `'max-lines-per-function': 'warn'`, `'max-params': 'warn'`, `'max-depth': 'warn'`, `'import/no-cycle': 'warn'`, `'react-hooks/exhaustive-deps': 'warn'`
- **Нарушает:** `docs/CONVENTIONS.md §1.1` strict-mode + здравый смысл (для денежного проекта warn недопустим)
- **Следствие:** `pnpm lint` в CI возвращает exit 0 даже при десятках warnings

---

## 5. 📜 Документы ↔ реальность

| Пункт в `docs/SECURITY_CHECKLIST.md` | Заявлено | Реальность |
|--------------------------------------|----------|-----------|
| `[x] Rate limit: /auth/login 10/15min` | nginx `limit_req_zone ... rate=10r/m` (1 минута, не 15) | **Не выполнено** |
| `[x] ThrottlerModule (App-level)` | n/a | **Не реализовано** (N3) |
| `[x] Helmet / security headers via Nginx` | только Nginx | **Частично** (N4) |
| `[x] Zod validation on all inputs` | n/a | **Не на всех** (N8, N9, C3) |
| `[x] Account Lockout 10/15min` | n/a | **Не реализовано** (N2) |
| `[x] Password: min 8 + min 1 digit` | только min 8 | **Не выполнено** (N1) |
| `[x] Docker non-root` | n/a | **Не выполнено** (N11) |
| `[x] PostgreSQL – no public exposure` | docker-compose: postgres не expose | **Выполнено** ✅ |
| `[x] Redis – password auth` | `--requirepass ${REDIS_PASSWORD}` | **Выполнено** ✅ |
| `[x] Refresh token – hash only in DB` | `hashRefreshToken` через `crypto.createHash('sha256')` | **Выполнено** ✅ |
| `[x] Webhook signature verification` | HMAC реализован | **Частично** (N5) — на JSON, не на raw body |
| `[x] All financial ops in prisma.$transaction()` | n/a | **Частично** (H1) — `lock/unlock` без Serializable |
| `[x] Optimistic locking wallet_accounts.version` | `version: { increment: 1 }` есть | **Частично** (H1) — не везде retry |
| `[x] .env in .gitignore, secrets in GitHub Secrets` | `.env` в `.gitignore` | **Выполнено** ✅ |

---

## 6. 🛡 Защита от плохого кода — что реально работает

### Спроектированные уровни (по `AGENTS.md` + `.cursorrules` + `ci.yml`)

```
1. Agent читает AGENTS.md / .cursorrules / docs/*   (enforcement = 0)
2. ESLint + Prettier                                  (enforcement = soft, см. A7)
3. Pre-commit hook (gitleaks + lint-staged)           (см. ниже: НЕ работает)
4. Pre-push hook (typecheck + tests)                  (см. ниже: СКИПАЕТСЯ)
5. CI: gitleaks + commitlint + (lint+typecheck+test+build) + deploy
   ─────────────────────────────────────────────────
   5a. gitleaks         работает, но только на push в main/dev и PR в main
   5b. commitlint       работает, но не на local commit
   5c. quality          работает, но это `needs` для deploy, не branch protection
   5d. deploy           только после зелёного CI ✅
```

### Реальное состояние

| Уровень | Должен | Реально | Статус |
|---------|--------|---------|--------|
| 1. Agent | читать 12 файлов bootstrap | да, но enforcement = 0 | 🟡 |
| 2. ESLint | запрет `any`, `console.log`, money rules | часть правил — `warn`, не блокирует | 🟡 |
| 3. Pre-commit | gitleaks + lint-staged | `core.hooksPath = /root/.casino-git-hooks`, но мы не root → папка не существует; `.husky/*` = `660` без exec-бита; `filemode = false` в `.git/config` → **хуки не срабатывают** | 🔴 |
| 4. Pre-push | typecheck + tests | `if [ ! -x ... ]` → exit 0 на FAT/sdcard | 🟡 |
| 5a. CI gitleaks | сканировать всю историю | ✅ на push в main/dev, ❌ на feature-ветки | 🟡 |
| 5b. CI commitlint | Conventional Commits | ✅ на push/PR | ✅ |
| 5c. CI quality | lint + typecheck + test + build | ✅ работает, **но не branch protection** — merge в main возможен с красным CI | 🔴 |
| 5d. CI deploy | только после зелёного CI | ✅ | ✅ |

**Итого:** 1.5 из 5 уровней работают надёжно. Branch Protection (настраивается в GitHub UI → Settings → Branches) — **не виден в коде**, но если не настроен вручную — основной вектор «плохой код в main» остаётся открытым.

---

## 7. 🐛 Конкретные сценарии попадания плохого кода в main

| # | Сценарий | Возможно? | Почему |
|---|----------|----------|--------|
| 1 | `git commit --no-verify` обходит pre-commit | ✅ | Хуки и так не работают (см. §6), но `--no-verify` обошёл бы и работающие |
| 2 | Force-push в main | ✅ | Без `branch protection` (если отключён в Settings) |
| 3 | Push в main напрямую с красным CI | ✅ | `quality` job — это `needs:`, не branch protection |
| 4 | Merge PR с красным CI | ✅ | Без "Require status checks to pass" в Settings |
| 5 | Push feature-ветки без сканирования | ✅ | gitleaks триггерится только на `main`/`dev` и PR в `main` |
| 6 | Push в feature-ветку с секретом | ✅ | Нет gitleaks, пока не открыт PR |
| 7 | Push минуя CI вообще | ✅ | Если branch protection не настроен |

---

## 8. 🔗 Перекрёстные ссылки

- **Безопасность:** `docs/SECURITY_BASELINE.md`, `docs/SECURITY_CHECKLIST.md`
- **Деньги / идемпотентность / транзакции:** `docs/AI_DEVELOPMENT_RULES.md §1, §2, §7, §8`
- **Стиль кода:** `docs/CONVENTIONS.md`
- **API контракты:** `docs/API_CONVENTIONS.md`
- **Архитектура модулей:** `.cursorrules` §"Module structure (CRITICAL)"
- **CI / Git hooks:** `.github/workflows/ci.yml`, `casino-platform/.husky/*`, `casino-platform/scripts/setup-hooks.sh`
- **Уже закрытые GAP'ы:** `docs/IMPLEMENTATION_GAPS.md` (GAP-01..GAP-13)

---

## 9. 🚦 Приоритеты (по убыванию риска)

### P0 — блокер для production
1. **N5** — HMAC webhook на raw body (денежный риск)
2. **N6** — KYC upload fileFilter (RCE / XSS)
3. **N3 + N4** — Throttler + Helmet (защита infra-уровня)
4. **H1** — `wallet.lock` Serializable + retry (double-spend)
5. **H2** — `wallet.unlock` валидация ≥ 0 (negative balance)
6. **H3** — `status.includes('paid')` → exact whitelist (ложный credit)
7. **N7** — `secure: false` → заменить на conditional (MITM)
8. **N10** — JWT secrets unsafe-patterns check в production

### P1 — должен быть закрыт до MVP
9. **N1** — password regex (digit requirement)
10. **N2** — account lockout
11. **N8 + N9** — Zod на forgot-password / deposits / withdrawals
12. **N11** — Dockerfile `USER node`
13. **H5** — `prisma` в use-case → repository interface
14. **H6** — Pino + redact
15. **H7** — Request-Id regex whitelist

### P2 — технический долг
16. **N12** — GlobalExceptionFilter `details` тип
17. **A1** — wallet module: добавить `application/use-cases/`
18. **A2** — убрать dynamic import в facade
19. **A3, A4** — проверить процесс NOWPayments webhook
20. **A5 + A6** — покрытие тестами до ~30% (minimum: money flow + idempotency)
21. **A7** — перевести `warn` правила в `error`
22. **C1–C6** — мелкие конвенции

### P3 — процессные дыры
23. Включить Branch Protection в GitHub UI для `main` (status checks: `secrets-scan`, `commitlint`, `quality`)
24. Создать `.github/CODEOWNERS` (минимум для `apps/api/src/modules/{payments,wallet,auth}/` и `infra/`)
25. Починить локальные хуки: запустить `sh scripts/setup-hooks.sh` на каждом dev-окружении

---

> **Куда переносить найденные баги:**
> - **Конкретный баг → новый GAP в `IMPLEMENTATION_GAPS.md`** (формат: `GAP-NN: описание — файл:строка`)
> - **Задача на исправление → GitHub Issue** (label: `bug`, `security`, `priority/p0/p1/p2`)
> - **Покрытие тестами → отдельный трек** (не GAP, это «Test Coverage Initiative»)
> - **CI / branch protection → settings репозитория**, не код
