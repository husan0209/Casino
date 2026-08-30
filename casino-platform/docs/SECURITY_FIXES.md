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
| 3 | bet/win/rollback не атомарны (wallet-операция и запись `gameTransaction` вне единой транзакции) | `game-callback.service.ts` + `wallet.ledger.prisma.ts` | ⬜ Нужен рефакторинг: ввести транзакционный контекст (tx) в `IWalletLedger`/`IGamePlayRepository`, чтобы bet/win/rollback проводились одним `$transaction`. Делать вместе с тестами (см. P2). |
| 4 | NOWPayments IPN подпись считается по raw body; по спецификации NOWPayments подписывается JSON с отсортированными ключами | `apps/api/src/modules/payments/infrastructure/clients/nowpayments.client.ts` | ⬜ Сверить с актуальной спецификацией IPN перед боевыми ключами; при расхождении заменить raw-body на канонический sorted-JSON HMAC-SHA512 |

## P1 — безопасность auth и данных

| # | Проблема | Файл | Статус |
|---|----------|------|--------|
| 5 | argon2 дефолты (~19MiB/2/1) вместо 65536/3/4 | `apps/api/src/modules/auth/infrastructure/services/password-hasher.service.ts` | ✅ Исправлено: `memoryCost/timeCost/parallelism` |
| 6 | JWT `verifyAccess` не проверяет `alg` и `iss` (alg-confusion / неверный issuer) | `apps/api/src/modules/auth/infrastructure/services/jwt.service.ts` | ✅ Исправлено: `alg === 'HS256'`, `iss === 'casino-platform'` |
| 7 | refresh-token принимается из `req.body` (ослабление CSRF) | `apps/api/src/modules/auth/presentation/controllers/auth.controller.ts` | ✅ Исправлено: только httpOnly cookie |
| 8 | Нет app-level rate-limit (`@nestjs/throttler`) | `app.module.ts`, `apps/api/package.json` | ✅ Исправлено 2026-08-30 (GAP-19): глобальный `ThrottlerGuard` 120 req/мин на IP; `/auth/*` — `@Throttle` 10/мин; webhook'и и game-callback — `@SkipThrottle()` (защита — HMAC). Env: `THROTTLE_*` |
| 9 | Нет `helmet()` (app-level headers) | `main.ts` | ✅ Исправлено 2026-08-30 (GAP-20): `app.use(helmet())` в bootstrap до парсеров; nginx-заголовки дублируются на уровне API |
| 10 | Нет account lockout после N неудачных логинов | `login.use-case.ts` | ✅ Исправлено 2026-08-30 (GAP-18): 10 неудач/15 мин → блок 30 мин; поля `failed_login_attempts/last_failed_at/locked_until` (миграция `20260830_account_lockout.sql`); enumeration-safe; env `LOCKOUT_*` |
| 11 | Frontend хранит access-token в localStorage + CSP `unsafe-inline/eval` | `apps/web/src/stores/auth.ts`, `infra/nginx/conf.d/casino.conf` | ⬜ Токен — в память (не persist), refresh — httpOnly cookie; ужесточить CSP (убрать eval, инлайн по-минимуму) |
| 12 | KYC `mimetype` доверяет клиентскому `Content-Type` (нет magic-byte проверки) | `apps/api/src/modules/kyc/presentation/controllers/kyc.controller.ts` | ⬜ Добавить проверку сигнатур JPEG/PNG/WebP/PDF |

## P2 — корректность и техдолг

| # | Проблема | Файл | Статус |
|---|----------|------|--------|
| 13 | `totalBet/totalWin` инкрементируется строкой (`increment: cb.betAmount`) | `game-callback.service.ts` | ⬜ Проверить после `prisma generate` (Prisma `Decimal` increment принимает number/Decimal). Если строка не проходит — перевести через `Decimal` |
| 14 | Тестов почти нет (2 spec-файла), деньги не покрыты | `apps/api` | ⬜ Минимум: money-flow + идемпотентность + rollback-типы (GAP-24) |
| 15 | Pino/redact вместо Nest Logger (пароли/токены в логах) | все `*.service.ts`/`*.use-case.ts` | ⬜ GAP-23 |
| 16 | `toMoney(n: any)` + 34 `as any` + глубокие относительные импорты | `wallet.ledger.prisma.ts` и др. | ⬜ GAP-22/26 |
| 17 | Nginx `api_auth:10r/m` не совпадает с требованием 10/15 мин | `infra/nginx/nginx.conf` | ⬜ Согласовать с GAP-19 и `SECURITY_BASELINE §2.3` |
| 18 | Drift env-дока: `REDIS_PASSWORD`/`DB_*` не в `env.validation.ts` | `ENVIRONMENT_VARIABLES.md` ↔ `env.validation.ts` | ⬜ GAP-29 |

---

## Порядок работ

1. Закрыть **P0 #3/#4** (атомарность + NOWPayments IPN) — это деньги.
2. Закрыть **P1 #8–#11** (throttler, helmet, lockout, токен/CSP).
3. **Runtime-приёмка** на Linux-FS: `pnpm install && pnpm db:generate && pnpm db:migrate && pnpm dev`,
   прогон `register → login → deposit → launch → bet/win/rollback → admin`.
4. **P2** — тесты money-flow/rollback, pino, `any`/импорты, env-parity.

> В эту ветку внесены правки #1, #2, #5, #6, #7, #8, #9, #10. Остальное (#3, #4, #11–#18) — по пунктам выше.