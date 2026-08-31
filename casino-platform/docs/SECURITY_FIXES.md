# Security Fixes — план и статус исправлений

> Создан по результатам глубокого аудита кода (деньги, auth, casino-callbacks, KYC).
> Это рабочий трекер: `✅` = уже в коде, `⬜` = предстоит. Не дублирует `SECURITY_CHECKLIST.md`,
> а фиксирует конкретные правки и их приоритет перед деплоем.

## Приоритеты

- **P0** — деньги / обход авторизации, исправлять до любого продакшена.
- **P1** — реальные security-риски, исправлять до публичного запуска.
- **P2** — техдолг, не блокирует, но обязателен в этом же релизе.

---

## P0 — деньги и атомарность казино-операций

| # | Проблема | Файл | Статус |
|---|----------|------|--------|
| 1 | `rollback()` перезачесляет `win` (всегда `credit` без учёта `originalTx.type`) | `apps/api/src/modules/casino/application/services/game-callback.service.ts` | ✅ Исправлено: bet → credit, win → debit, rollback → ошибка |
| 2 | `confirmWithdrawal` может увести `locked`/`balance` в минус (нет guard, в отличие от `unlock`) | `apps/api/src/modules/wallet/infrastructure/ledger/wallet.ledger.prisma.ts` | ✅ Исправлено: guard `balance >= amount` + `locked >= amount` |
| 3 | ~~bet/win/rollback не атомарны (wallet-операция и запись `gameTransaction` вне единой транзакции)~~ | `game-callback.service.ts` + `wallet.ledger.prisma.ts` | ✅ Исправлено 2026-08-30: `WalletFacade.runInTransaction` (Serializable, раннер в wallet infrastructure) + `CreditInput.tx` и `tx?` в методах `IGamePlayRepository`; ledger при переданном tx НЕ открывает свой `$transaction` (Prisma запрещает вложенные); дубликат-чек дублируется внутри tx (гонка одновременных bet/rollback); 11 тестов `money-flow.spec.ts` фиксируют атомарность структурно (один tx на все операции) |
| 4 | ~~NOWPayments IPN подпись считается по raw body; по спецификации NOWPayments подписывается JSON с отсортированными ключами~~ | `apps/api/src/modules/payments/infrastructure/clients/nowpayments.client.ts` | ✅ Исправлено 2026-08-30: dual-check — (1) канонический sorted-JSON по официальному Python-сниппету (sorted keys + compact separators + ensure_ascii \uXXXX + исходные числовые токены через маркеры, чтобы repr(10.0) не схлопывался в 10), (2) PHP-флейвор (экранированный «/»), (3) raw-body HMAC (обратная совместимость). Type-confusion guard: подсчёт вставленных/найденных маркеров; при коллизии канон-ветка пропускается. 13 тестов с эталонным Python-зеркалом (`nowpayments-ipn.spec.ts`). Перед боевыми ключами: прогнать на sandbox |

## P1 — безопасность auth и данных

| # | Проблема | Файл | Статус |
|---|----------|------|--------|
| 5 | argon2 дефолты (~19MiB/2/1) вместо 65536/3/4 | `apps/api/src/modules/auth/infrastructure/services/password-hasher.service.ts` | ✅ Исправлено: `memoryCost/timeCost/parallelism` |
| 6 | JWT `verifyAccess` не проверяет `alg` и `iss` (alg-confusion / неверный issuer) | `apps/api/src/modules/auth/infrastructure/services/jwt.service.ts` | ✅ Исправлено: `alg === 'HS256'`, `iss === 'casino-platform'` |
| 7 | refresh-token принимается из `req.body` (ослабление CSRF) | `apps/api/src/modules/auth/presentation/controllers/auth.controller.ts` | ✅ Исправлено: только httpOnly cookie |
| 8 | Нет app-level rate-limit (`@nestjs/throttler`) | `app.module.ts`, `apps/api/package.json` | ✅ Исправлено 2026-08-30 (GAP-19): глобальный `ThrottlerGuard` 120 req/мин на IP; `/auth/*` — `@Throttle` 10/мин; webhook'и и game-callback — `@SkipThrottle()` (защита — HMAC). Env: `THROTTLE_*` |
| 9 | Нет `helmet()` (app-level headers) | `main.ts` | ✅ Исправлено 2026-08-30 (GAP-20): `app.use(helmet())` в bootstrap до парсеров; nginx-заголовки дублируются на уровне API |
| 10 | Нет account lockout после N неудачных логинов | `login.use-case.ts` | ✅ Исправлено 2026-08-30 (GAP-18): 10 неудач/15 мин → блок 30 мин; поля `failed_login_attempts/last_failed_at/locked_until` (миграция `20260830_account_lockout.sql`); enumeration-safe; env `LOCKOUT_*` |
| 11 | ~~Frontend хранит access-token в localStorage + CSP `unsafe-inline/eval`~~ | `apps/web/src/stores/auth.ts`, `apps/web/src/lib/api.ts`, `infra/nginx/conf.d/casino.conf` | ✅ Исправлено 2026-08-30: `persist` убран — access-token и user только в памяти (XSS-кража localStorage более невозможна); silent-refresh single-flight по 401 + повтор исходного запроса (`_retry`, /auth/* исключены); `hydrate()` при загрузке: `/auth/refresh` по httpOnly-cookie → `/users/me`; logout чистит серверную cookie. CSP: `unsafe-eval` убран, добавлены `object-src 'none'` и `base-uri 'self'`. Остаток: nonce-CSP для inline-скриптов Next требует middleware на стороне Next |
| 12 | ~~KYC `mimetype` доверяет клиентскому `Content-Type` (нет magic-byte проверки)~~ | `apps/api/src/modules/kyc/presentation/controllers/kyc.controller.ts` | ✅ Исправлено 2026-08-30: `memoryStorage` (недоверенный контент на диск не попадает) + `common/files/file-sniffer.ts` по сигнатурам JPEG/PNG/WebP/PDF; файл пишется только после sniff, имя = UUID + расширение от sniffed-типа, в БД пишется sniffed-тип. **Тот же паттерн для аватаров** (`users.controller.ts`: раньше `extname(originalname)` шёл прямо в имя файла); для аватаров PDF дополнительно запрещён. 8 тестов (в т.ч. PNG под видом JPEG, GIF/HTML/ZIP-отказы, обрезанные буферы) |

## P2 — корректность и техдолг

| # | Проблема | Файл | Статус |
|---|----------|------|--------|
| 13 | ~~`totalBet/totalWin` инкрементируется строкой (`increment: cb.betAmount`)~~ | `game-callback.service.ts` | ✅ Проверено 2026-08-30 интеграционным тестом на реальном Postgres (`game-round.integration.spec.ts`): `increment: '10.50'` + `'0.25'` → `10.75` — Prisma принимает строку для Decimal-инкремента без потери точности; код менять не нужно. Фиксирует также запись GameTransaction с Decimal-строками |
| 14 | ~~Тестов почти нет; деньги не покрыты~~ | `apps/api` | 🔶 В основном закрыто 2026-08-30 (GAP-24): `money-flow.spec.ts` (11); `ledger.integration.spec.ts` (6, реальный Postgres в CI через `prisma db push` + `LEDGER_INTEGRATION=1`): idempotency, InsufficientFunds, **откат tx при сбое** и bet/win-сценарий в одной транзакии — проверено на настоящем Serializable-Postgres; `account-lockout.spec.ts` (5); `logger-redact.spec.ts` (3); `nowpayments-ipn.spec.ts` (13); `kyc-file-sniffer.spec.ts` (8). Осталось: E2E (GAP-05) |
| 15 | Pino/redact вместо Nest Logger (пароли/токены в логах) | все `*.service.ts`/`*.use-case.ts` | ✅ Исправлено 2026-08-30 (GAP-23): nestjs-pino + redact (password/token/authorization/cookie на 3 уровнях + req.body.*); фильтр не логирует err целиком; тест logger-redact.spec.ts |
| 16 | `toMoney(n: any)` + 34 `as any` + глубокие относительные импорты | `wallet.ledger.prisma.ts` и др. | ⬜ GAP-22/26 |
| 17 | ~~Nginx `api_auth:10r/m` не совпадает с требованием 10/15 мин~~ | `infra/nginx/nginx.conf` | ✅ Исправлено 2026-08-30: это разные слои — nginx `api_auth 10r/m` = пер-IP троттлинг (совпадает с примером ТЗ и app-`THROTTLE_AUTH_LIMIT=10/мин` из GAP-19); «10 неудачных login за 15 мин → блок 30 мин» (§2.3) — per-account lockout, реализован на app-уровне (PR #4: `LOCKOUT_*`). Семантика задокументирована в nginx.conf/casino.conf/SECURITY_BASELINE. Фактический дрифт устранён: добавлен `limit_req_status 429` во все location с limit_req (по ТЗ; раньше был дефолтный 503) |
| 18 | ~~Drift env-дока: `REDIS_PASSWORD`/`DB_*` не в `env.validation.ts`~~ | `ENVIRONMENT_VARIABLES.md` ↔ `env.validation.ts` | ✅ Исправлено 2026-08-30 (GAP-29 закрыт): все 39 ключей §22 добавлены в Zod-схему (числовые — coerce, URL — url(), логи — enum); все optional — код читает process.env с дефолтами, поведение не меняется; docs-guard D3 больше не предупреждает |

---

## Порядок работ

1. ~~Закрыть **P0 #3/#4**~~ — оба закрыты 2026-08-30 (атомарность bet/win/rollback + NOWPayments IPN dual-check). Перед боевыми ключами: sandbox-прогон NOWPayments.
2. Закрыть **P1 #8–#11** (throttler, helmet, lockout, токен/CSP).
3. **Runtime-приёмка** на Linux-FS: `pnpm install && pnpm db:generate && pnpm db:migrate && pnpm dev`,
   прогон `register → login → deposit → launch → bet/win/rollback → admin`.
4. **P2** — тесты money-flow/rollback, pino, `any`/импорты, env-parity.

> В эту ветку внесены правки #1, #2, #5, #6, #7, #8, #9, #10, #15. Остальное (#3, #4, #11–#14, #16–#18) — по пунктам выше.