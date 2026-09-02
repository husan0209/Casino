# Implementation Gaps — честный аудит ТЗ vs код

> Дата аудита: 2026-08-23, ревизия 2026-08-24. Цель: зафиксировать расхождения между ТЗ (`docs/tz-part-*.md`) и фактическим кодом.
> Последняя ревизия: **2026-09-01 — аудит готовности к запуску, добавлены GAP-31…GAP-38** (два P0-блокера: миграции, реферальные выплаты).
> Этот файл — точка правды по статусу. Не отмечать пункт «готов», пока не работает end-to-end.

## 🔴 CRITICAL — блокеры (API не собирается)

### GAP-01. ✅ ИСПРАВЛЕНО 2026-08-23 — модуль auth достроен
Восстановлены отсутствующие файлы по контрактам существующих use-case'ов:
- `domain/errors.ts` — AppError-классы (INVALID_CREDENTIALS, EMAIL_NOT_VERIFIED, TOKEN_*, SESSION_* …)
- `domain/entities/user.entity.ts`, `domain/repositories/{user,session,auth-provider,verification-token}.repository.ts` (+ index barrel)
- `infrastructure/services/password-hasher.service.ts` (argon2id), `jwt.service.ts` (HS256 на node:crypto — jsonwebtoken недоступен в оффлайн-store), `email-queue.service.ts` (dev=лог со ссылкой, prod без SMTP_HOST=fail-closed EmailNotConfiguredError)
- `infrastructure/repositories/*.prisma.ts` ×4
- `application/use-cases/register.use-case.ts` (уникальность email, реферальный код 8 симв. UC-REF-01/02, verification-токен 24ч)
- Попутно починен `admin/infrastructure/admin-jwt.service.ts` (импортировал отсутствующий jsonwebtoken → HS256 на crypto)
- **Проверка:** `tsc --noEmit` для @casino/api — 0 ошибок. Runtime-проверка (реальный регистр/логин) требует БД+Redis — не выполнялась в этой среде.
Также исправлены попутные пре-существующие баги сборки: битый путь импорта zod-validation.pipe в auth.controller (`../../../`→`../../../../`), тип meta в shared-types ApiSuccessResponse (+PaginationMeta), ~25 strict-mode ошибок TS7006/7031/6133 в старых модулях, ambient-типы multer (см. Environment).

### GAP-02. ✅ ИСПРАВЛЕНО 2026-08-23 — BullMQ-инфраструктура реализована
`apps/api/src/queues/`:
- `queue.types.ts` — `EMAIL_QUEUE_PORT`, `EmailJobData`, `EnqueueResult`
- `infrastructure/email.queue.ts` — продюсер `BullMqEmailQueue` (attempts 5, backoff exp 5s, removeOnComplete/Fail) + fallback `DevLogEmailQueue`
- `infrastructure/smtp.mailer.ts` — `MAILER_PORT`: `SmtpMailer` (nodemailer ленивым require — optional peer) / `DevLogMailer`; в production без `SMTP_HOST` приложение не стартует (fail-closed)
- `application/email.worker.ts` — консьюмер очереди `email` (тот же процесс, MVP), проставляет `notifications.sentAt`
- Подключены producers: auth (`EmailQueueService` → verify/reset письма с HTML), notifications (UC-NOTIF-01, проверка `user_settings.notificationsEmail`)
- env: добавлены опциональные `SMTP_PORT/SMTP_USER/SMTP_PASS`
- **Проверка:** tsc 0 ошибок. Runtime (реальная отправка) требует Redis+SMTP на Linux-FS среде.
- Осталось после MVP: вынос воркера в отдельный процесс, rich HTML-шаблоны (`templates/index.ts` — пока plain text).

## 🟠 HIGH — фичи заявлены, но не работают

| # | Gap | Где | TZ |
|---|-----|-----|----|
| GAP-03 | ~~Google OAuth — заглушка~~ | ✅ Реализовано 2026-08-24: authorization-code flow (`GET /auth/google/url` со state=HMAC 10 мин; `POST /auth/google` — обмен кода, userinfo, провижининг через `OAuthUserProvisioningService`, сессия+refresh-cookie). Требует `GOOGLE_CLIENT_ID/SECRET`. Runtime не проверялся (нет сети/ключей в среде) |
| GAP-04 | ~~Telegram Login — заглушка~~ | ✅ Реализовано 2026-08-24: `POST /auth/telegram` — верификация виджета (secret=SHA256(bot_token), HMAC data-check-string, timingSafeEqual, auth_date ≤24ч), пользователь без email (schema nullable), сессия. Требует `TELEGRAM_BOT_TOKEN` |
| GAP-05 | ~~Email-отправка отсутствует~~ | ✅ Закрыт вместе с GAP-02: очередь+воркер+SmtpMailer; в prod без SMTP_HOST — старт невозможен (fail-closed) |
| GAP-06 | ~~Rukassa createPayment — заглушка~~ | ✅ Реализовано 2026-08-24: реальный HTTP (`POST {RUKASSA_API_BASE|pay.rukassa.is}/api/v1/order/create`, заголовки shop_id/api_key, timeout 30с), getPaymentStatus; dev без ключей — лог-стаб. Верификация вебхука HMAC-SHA256 активна в prod (раньше кидала NOT_IMPLEMENTED). Runtime — нужны боевые ключи |
| GAP-07 | ~~NOWPayments — стабы~~ | ✅ Реализовано 2026-08-24: `POST /v1/payment` (x-api-key), `/estimate`, `/payment/{id}`; курсы больше не хардкод при наличии ключа; IPN HMAC-SHA512 активен в prod. Env: `NOWPAYMENTS_API_BASE`. Runtime — нужен NOWPAYMENTS_API_KEY |
| GAP-08 | ~~Только DemoProvider~~ | ✅ Код готов 2026-08-24: адаптер **GitSlotPark** (`gitslotpark.adapter.ts`) — агрегатор Pragmatic Play/PG Soft/Amatic/Amusnet (один seamless-протокол на 4 бренда). userAuth/gamelist + callback-операции GetBalance/Withdraw/Deposit/BetWin/Rollback с HMAC-SHA256-sign, маршруты `/provider-callback/gitslotpark/{Op}`. ⚠️ До продакшена: сверить порядки конкатенации sign по каждой операции с менеджером GSP; связка `userID→сессия` в GameCallbackService и атомарность BetWin — проверить runtime с тестовыми ключами |
| GAP-09 | ~~Admin sync-games — заглушка~~ | ✅ Реализовано 2026-08-24: `syncGames` вызывает `adapter.fetchGameList()`, upsert по `[providerId, externalGameId]`, slug = name+md5-суффикс, обновляет rtp/thumbnail/hasDemo/metadata, пересчитывает gameCount; новые игры создаются выключенными (UC-GAME-19). Кнопка «Синхронизировать» в UI админки уже показывает результат |
| GAP-10 | ~~Frontend админки — заглушки~~ | ✅ Исправлено 2026-08-23: реальный UI на 13 страницах (`apps/admin/src`): логин c JWT (zustand persist), guard-layout, дашборд на живых metrics/charts/events + Recharts, users (block/unblock), transactions, payments, withdrawals (single+batch approve/reject), KYC (approve/reject/resubmit), games/providers (toggle/sync), support (диалог+внутр.заметки+приоритет+close), referrals (stats), audit, admins (superadmin CRUD), settings. `tsc -p apps/admin` = 0 |
| GAP-11 | ~~Нет API метрик дашборда~~ | ✅ Исправлено 2026-08-23: `admin/application/dashboard.service.ts` + `AdminDashboardController` (`/admin/dashboard/metrics\|charts\|events`), raw SQL по date_trunc, деньги string. Runtime — нужна БД (prisma generate) |
| GAP-12 | ~~Нет batch approve/reject~~ | ✅ Исправлено 2026-08-23: `POST /admin/withdrawals/batch-approve\|batch-reject`, независимая обработка каждой заявки + audit-log сводки; single-эндпоинты рефакторнуты на общие helpers + `WithdrawalInvalidStatusError`(AppError) |
| GAP-13 | ~~Referral rewards помечаются `credited` без реального зачисления через WalletFacade~~ | `referrals/application/referral-calc.service.ts:56-60` | UC-REF-03 шаг 5 — ⚠️ **частично**: само зачисление реальное (`walletFacade.credit`, тип `REFERRAL_REWARD`, ключ `ref_reward_<id>`), **но метод `runDaily` никто не вызывает** → деньги всё равно не движутся. Перенесено в **GAP-32** (аудит 2026-09-01) |

## 🛡 АУДИТ 2026-08-25 → открытые пункты (ревизия 2026-08-28)

> Полный снимок аудита с ревизией каждого пункта: **`docs/archive/audit-2026-08-25.md`**.
> Из 30 пунктов аудита **17 исправлены** (список в снимке), открытые — перенесены сюда:

| # | Audit ID | Что | Где | Приоритет |
|---|----------|-----|-----|-----------|
| GAP-18 | N2 | ~~Account lockout после N неудачных логинов (SECURITY_BASELINE §2.3: 10 за 15 мин → блок 30 мин)~~ | `auth/application/use-cases/login.use-case.ts` | ✅ P1 закрыт 2026-08-30: поля `failed_login_attempts/last_failed_at/locked_until` (миграция `20260830_account_lockout.sql` — применить при деплое); 10 неудач/15 мин → блок 30 мин; enumeration-safe (неверный пароль → всегда INVALID_CREDENTIALS, лок виден только при верном); уже заблокированный аккаунт не продлевается (DoS-защита); юнит-тесты `test/account-lockout.spec.ts`. Env: `LOCKOUT_MAX_ATTEMPTS/WINDOW_MS/DURATION_MS` |
| GAP-19 | N3 | ~~ThrottlerModule (app-level rate limit)~~ | `app.module.ts`, `apps/api/package.json` | ✅ P0 закрыт 2026-08-30: `@nestjs/throttler` v6, глобальный `ThrottlerGuard` (APP_GUARD) 120 req/мин на IP; `/auth/*` строже — `@Throttle` 10/мин; webhook'и провайдеров и game-callback — `@SkipThrottle()` (у них HMAC). Env: `THROTTLE_TTL_MS`, `THROTTLE_GLOBAL_LIMIT`, `THROTTLE_AUTH_LIMIT` |
| GAP-20 | N4 | ~~helmet() middleware~~ | `main.ts`, `apps/api/package.json` | ✅ P0 закрыт 2026-08-30: `app.use(helmet())` в bootstrap до парсеров; API отдаёт только JSON → дефолтный CSP безопасен, `frame-ancestors 'none'` против clickjacking |
| GAP-21 | N8, N9, C3 | ~~Zod-валидация на всех `@Body` inputs~~ | `apps/api/src/modules/*/presentation/controllers/` | ✅ P1 закрыт 2026-08-30: `@UsePipes(new ZodValidationPipe(Schema))` на всех клиентских `@Body` (auth incl. google/telegram, users profile/settings/self-exclude, casino launch/demo, kyc submit/documents, support + support-admin, все admin-контроллеры incl. finance credit/debit/batch). Новые DTO-схемы по модулям; неизвестные ключи вырезаются (anti mass-assignment). **Exempt (задокументировано в коде):** `payments-webhook` и `provider-callback` — payload'ы провайдеров под HMAC, жёсткая схема отбила бы валидные коллбэки |
| GAP-22 | A1, C5, C6 | ~~Wallet-модуль: вынести lock/unlock/confirmWithdrawal в `application/use-cases/` (4-слойка);~~ ~~убрать `toMoney(n: any)`~~; ~~разбить `runCreditDebit`~~. **2026-08-30: G1-часть закрыта** — репозитории извлечены для casino, notifications, referrals, users, admin; **2026-08-31: типизация закрыта** — `toMoney` без any; tx-клиенты `Prisma.TransactionClient`; `CreditInput.type: LedgerEntryType` (поймал реальный баг lowercase-типа); 0 `as any`. **2026-08-31: 4-слойка закрыта** — `LockFundsUseCase`/`UnlockFundsUseCase`/`ConfirmWithdrawalUseCase` в `application/use-cases/` (WalletFacade делегирует, внешний API прежний); `runCreditDebit` разбит (`getOrCreateWallet` + `applyCreditDebit`); NOTE-компромисс устранён | `modules/wallet/` | ✅ P2 |
| GAP-23 | H6 | ~~Pino + redact вместо Nest Logger (пароли/токены могут попасть в логи)~~ | `apps/api/src/common/logger/logger.options.ts` | ✅ P1 закрыт 2026-08-30: `nestjs-pino` + pino-http по всему Nest (`useLogger`); redact-пути `password/token/authorization/cookie/set-cookie` на 3 уровнях вложенности + `req.body.*`; кастомный req-сериализатор (body в логах — но с redact); `GlobalExceptionFilter` больше не логирует `err` целиком (только type/message/stack через PinoLogger); корреляция request-id между pino и RequestIdMiddleware через общий `resolveRequestId`; env `LOG_LEVEL`/`LOG_FORMAT` подключены (pretty в dev, json в prod). Тесты `test/logger-redact.spec.ts` — секреты физически отсутствуют в выводе лога |
| GAP-24 | A5, A6 | ~~Покрытие тестами: минимум — money flow + idempotency~~ | `apps/api` | ✅ P2 закрыт 2026-08-31: `money-flow.spec.ts` (11), `ledger.integration.spec.ts` (6 на реальном Postgres, в CI `prisma db push` + `LEDGER_INTEGRATION=1` — откат tx при сбое и idempotency проверены на Serializable-БД), `nowpayments-ipn.spec.ts` (13), `kyc-file-sniffer.spec.ts` (8), `account-lockout.spec.ts` (5), `logger-redact.spec.ts` (3), **E2E (GAP-05) — `player-lifecycle.e2e.spec.ts` (9, CI-шаг с собранным сервером)** |
| GAP-25 | A7 | ~~Довести ESLint до обещанного в QUALITY_GATES §2.1: `max-params` warn(4)→error(3), `complexity` warn(10)→error(10)~~ | `.eslintrc.js:70,74` | ✅ P2 закрыт 2026-09-01: пороги подняты, разобраны **45 `max-params` + 13 `complexity`** в `apps/api/src` (0 errors). Бизнес-методы переведены на input-объекты вместе с вызовами (`wallet` lock/unlock/confirm → `WithdrawalOpArgs`, `kyc.setStatus`, `support` createTicket/listUserTickets/addMessage, `referrals` sumTransactions/findReward/processUserRewards, `casino` findRoundsWithGame/findOrCreateRound/creditWin, `notifications.list`, `payment-request.listUser`, `favorites.history`, webhook `execute` → `Process*WebhookInput`); complexity — на приватные методы/таблицы (`sniffDocumentMime`, `GlobalExceptionFilter`, `syncGames`, `provider-callback.handle`, GitSlotPark verify/parse, Rukassa/NOWPayments webhook). Исключения только framework-imposed и описаны: `overrides` `max-params: off` для `**/*.controller.ts` + `src/main.ts` (сигнатуру задают декораторы/express-verify) и inline-disable для 10 DI-конструкторов — см. QUALITY_GATES §2.1.1 |
| GAP-26 | C4 | ~~Относительные импорты `../../../../` → path aliases~~ | `apps/api/src/modules/**` | ✅ P3 закрыт 2026-09-01: **72 импорта** (все с ≥3 `../`) переведены на `@modules/<mod>/…` (кросс-модульные) и `@/<seg>/…` (общий код); внутримодульные `../` оставлены. Rантайм-резолвер не понадобился: `build` = `nest build && tsc-alias -p tsconfig.build.json` — алиасы переписываются в относительные пути в `dist`, `node dist/main.js` (prod/Docker) работает без `tsconfig-paths`. `baseUrl`+`paths` объявлены в `apps/api/tsconfig.json` (иначе `pnpm typecheck` резолвил `./src/*` от `packages/tsconfig`); алиасы продублированы в `vitest.config.ts`. Доказательство рантайма — CI-шаг E2E (`pnpm build` → `node apps/api/dist/main.js` → 9/9). Правила — CONVENTIONS §3.1 |
| GAP-27 | NEW | ~~argon2 без явных параметров~~ | `password-hasher.service.ts:7` | ✅ P1 закрыт 2026-08-30: `PasswordHasher.hash` → `argon2.hash(plain, {type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4})` (совпадает с SECURITY_BASELINE §2.1 и admin-хэшером `admin-users.service.ts:28`) |
| GAP-28 | H4 | ~~Идемпотентность депозита: `deposit_${pr.id}` — добавить защиту и по `external_id`~~ | `process-rukassa-webhook.use-case.ts`, `process-nowpayments-webhook.use-case.ts` | ✅ P3 закрыт 2026-09-01: ключ проводки депозита — **`deposit_${provider}_${externalId}`** (был `deposit_${pr.id}`, который защищал только уникальность НАШЕЙ платёжки). Повторный коллбэк по тому же внешнему платежу, смэпившийся на другую платёжку (рассинхрон маппинга), больше не зачислит дважды — уникальный индекс `ledger.idempotencyKey` отсекает на уровне БД. Первый уровень защиты сохранён: `pr.status === 'completed'` → `duplicate` до wallet.credit. Регресс-тесты `test/deposit-idempotency.spec.ts` (4): NP/Rukassa — ключ от external_id, повторная доставка той же платёжки — без credit, отсутствие external_id — без зачисления |
| GAP-29 | NEW (docs-guard D3) | ~~env.validation.ts валидирует не все ключи `.env.example`~~ | `packages/shared-config/src/env.validation.ts` | ✅ Закрыт 2026-08-30: все 39 ключей §22 в Zod-схеме (coerce/url/enum, все optional — поведение кода не меняется); D3 молчит |
| GAP-30 | NEW (PR-0) | 14 методов 61–88 строк (prettier-инфляция после `--fix`): `game-callback.service` bet/win/rollback, `dashboard.service` metrics/events, `wallet.ledger.prisma` runCreditDebit/lock/unlock/confirmWithdrawal, `list-games.use-case` execute, webhook execute ×2, `provider-callback.controller` handle — разбить на приватные методы, вернуть лимит 60. Делать вместе с тестами (GAP-21/24) | перечисленные файлы | P3 |

## 🔎 АУДИТ ГОТОВНОСТИ К ЗАПУСКУ — 2026-09-01 (GAP-31…GAP-38)

> Повод: после закрытия P0/P1/P2-трекера и зеленого CI задан вопрос «проект готов?».
> Аудит сравнивал **фактический код** с ТЗ ч.3 §13, ч.7 §10/§12 и `docs/QA_CHECKLIST.md`.
> Найдено 8 расхождений, из них 2 — блокеры запуска.
>
> **Формат обязателен для исполнителя (в т.ч. другого AI-агента):** пункт закрывается
> только при выполнении «Критерия приёмки» целиком. Отметка «готово» без критерия —
> причина, по которой GAP-13 полгода числился закрытым при неработающем начислении.
> Правило INDEX.md §6.3: закрыл код → обнови этот файл в том же PR.

| # | Что не работает | Где | Приоритет | Критерий приёмки |
|---|-----------------|-----|-----------|------------------|
| GAP-31 | ~~**Нет Prisma-миграций.**~~ **✅ P0 закрыт 2026-09-02.** Baseline-миграция migrations/0_init/migration.sql (774 строки, 27 CREATE TABLE, все enum/индексы/FK) сгенерирована prisma migrate diff --from-empty из schema.prisma — покрывает и три historical manual/*.sql (поля last_payment_method, self_excluded_until, account_lockout включены; в manual/ добавлен README «применены в baseline, не запускать»). migration_lock.toml: postgresql. В CI db push заменён на prisma migrate deploy + дрейф-детектор (migrate diff --from-schema-datasource --to-schema-datamodel с непустым выводом = падение джобы). Примечание: на БД, созданных ДО введения миграций, один раз выполнить migrate resolve --applied 0_init (см. migrations/manual/README.md). Для применимости в проде: schema-engine не запускается на Android/Termux — генерация выполнена одноразовым workflow на ubuntu-раннере (артефакт), workflow удалён из ветки до мержа | `packages/database/prisma/`, `infra/scripts/deploy.sh` | ~~P0~~ ✅ закрыт | Критерии: 1) ✅ baseline покрывает 27 моделей + 3 manual; 2) — проверяется в CI этого PR: пустой Postgres → migrate deploy создаёт схему; 3) ✅ дрейф-детектор встроен в CI (шаг Verify no schema drift, пустой вывод = ок); 4) ✅ manual/README.md; 5) ✅ ci.yml: migrate deploy вместо db push |
| GAP-32 | **Реферальные начисления не происходят никогда.** `ReferralCalcService.runDaily` реализован полностью и честно (реальный `walletFacade.credit`, тип `REFERRAL_REWARD`, ключ `ref_reward_<id>`), но **у него нет ни одного вызывающего**: ни cron, ни admin-эндпоинта, ни воркера — `grep runDaily` находит только определение. `admin/referrals` отдаёт только статистику. Т.е. GGR-share 5% из ТЗ не выплачивается | `apps/api/src/modules/referrals/application/referral-calc.service.ts`, `apps/api/src/modules/referrals/presentation/referrals-admin.controller.ts` | **P0 — деньги не движутся** | 1) появился триггер: cron-job (см. GAP-33) **и** ручной `POST /admin/referrals/run-daily` для superadmin с audit-log; 2) интеграционный тест на реальной БД: игрок с GGR>0 → после запуска в `ledger_entries` есть проводка `REFERRAL_REWARD` с суммой `ggr × rate` и `referral_rewards.status='credited'`; 3) повторный запуск за тот же день **не** создаёт второй проводки (проверяется существующей защитой `findReward` + уникальным `idempotencyKey`); 4) день без GGR → статус `zero`, проводок нет |
| GAP-33 | **Ни одного scheduled job.** ТЗ ч.3 §13 требует три: истечение pending-депозитов старше 2ч (крипто — по `expires_at`), обновление курсов каждые 5 мин, напоминание админу о выводах в pending >24ч. BullMQ подключён, но очередь одна — `email`, без `repeat`; `@nestjs/schedule` в зависимостях отсутствует. Следствие: pending-депозиты живут вечно, вывод может «зависнуть» незамеченным | `apps/api/src/queues/queue.types.ts`, `apps/api/src/queues/application/email.worker.ts` | P1 | 1) три повторяющиеся job'ы зарегистрированы (BullMQ `repeat` или `@nestjs/schedule`), интервалы из env, а не хардкод; 2) юнит-тест на каждую: депозит `pending` + `createdAt` 3ч назад → `expired`; депозит 1ч назад → не тронут; 3) напоминание о выводе создаёт запись в `notifications` для админа и не дублируется при повторном тике; 4) job'ы идемпотентны и логируют сводку (обработано/пропущено); 5) документировано в `docs/ENVIRONMENT_VARIABLES.md` + `.env.example` (D3-парити) |
| GAP-34 | **Курсы валют захардкожены.** Модель `ExchangeRate` в схеме есть, но в коде к ней **ни одного обращения**: конвертация RUB↔крипто идёт по константам `DISPLAY_RUB_RATES`. От этих чисел зависят KYC-лимит 5000₽ (`limit_remaining`) и админ-отчётность → при движении курса USDT/BTC лимит и GGR считаются неверно | `packages/shared-config/src/geo.config.ts`, `apps/api/src/modules/geo/domain/geo-config.policy.ts` | P1 | 1) сервис курсов пишет в `exchange_rates` (source, fetched_at) и кеширует в Redis TTL 5 мин; 2) конвертация читает БД/кеш, `DISPLAY_RUB_RATES` остаются только **fallback** при пустой таблице; 3) тест: подменённый курс в БД меняет `limit_remaining` в ответе KYC-API; 4) устаревший курс (fetched_at > 1ч) логирует warning и не роняет запрос; 5) деньги — только `string`/Decimal (CONVENTIONS §5) |
| GAP-35 | **Health-эндпоинты фиктивные.** `/health/ready` возвращает `{ready:true}` **без проверки** Postgres/Redis, `/health/details` из ТЗ ч.7 §10.1 нет вовсе. Docker healthcheck (`docker-compose.prod.yml`) бьёт в `/health` → контейнер отмечается healthy при мёртвой БД, а E2E-`wait-on` даёт ложный зелёный | `apps/api/src/modules/health/presentation/health.controller.ts`, `docker-compose.prod.yml` | P1 | 1) `/health/ready` делает `SELECT 1` к БД и `PING` к Redis, при недоступности → **503** (fail-closed); 2) добавлен `/health/details` с `services{database,redis,email_queue}`, счётчиками очереди и uptime, закрыт от публичного доступа (internal/admin); 3) healthcheck в compose переведён на `/health/ready`; 4) тест: с выключенным Redis `ready` → 503, `live` → 200 (liveness не зависит от внешних сервисов) |
| GAP-36 | KYC-лимит не виден игроку: API отдаёт `limit_remaining` в запрошенной валюте (`get-kyc-status.use-case.ts`), но во фронте нет ни одного использования — на странице KYC нет остатка лимита. Хвост GAP-17 | `apps/web/src/app/kyc/page.tsx` | P2 | 1) страница KYC и депозитный флоу показывают остаток лимита в активной валюте; 2) при исчерпании лимита CTA ведёт на верификацию, а не на ошибку 422 после отправки формы; 3) значение берётся из API (не пересчитывается на клиенте) |
| GAP-37 | Дрейф деплой-документации: `docs/DEPLOY.md` §CI/CD ссылается на `.github/workflows/deploy.yml`, которого нет (деплой — job в `.github/workflows/ci.yml`); ТЗ ч.7 §12.3 требует скрипт resource-check.sh в `infra/scripts/`, его нет (есть health-check.sh, backup, rollback). Плюс не описано, что деплой пропускается без VPS-секретов (#23/#24) | `docs/DEPLOY.md`, `infra/scripts/` | P3 | 1) DEPLOY.md описывает фактический пайплайн (единый ci.yml, deploy-job после 4 зелёных чеков, skip без секретов); 2) либо добавлен resource-check.sh, либо в ТЗ-хвостах помечено «не входит в MVP» — без висящей ссылки; 3) docs-guard D1/D2 зелёные |
| GAP-38 | **На чистом проде некому войти в админку.** Первый superadmin создаётся только `packages/database/src/seed.ts` (`pnpm db:seed`), но ни `infra/scripts/deploy.sh`, ни deploy-job его не вызывают и в `docs/DEPLOY.md` шага нет. Дефолтный пароль в сиде — `dev_superadmin_password_123` | `packages/database/src/seed.ts`, `infra/scripts/deploy.sh`, `docs/DEPLOY.md` | P2 | 1) в DEPLOY.md есть шаг первичной инициализации с обязательными `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`; 2) сид **отказывается** создавать админа с дефолтным паролем при `NODE_ENV=production` (fail-closed); 3) повторный запуск идемпотентен (уже есть); 4) в `.env.example` + ENVIRONMENT_VARIABLES §22 обе переменные описаны (D3-парити) |

### Что НЕ является гэпом (проверено 2026-09-01)

Чтобы исполнитель не переделывал готовое: 12 модулей API и 4-слойка на месте; 18 страниц web + 14 админки без заглушек (`grep TODO` по фронту — пусто); 27 моделей в `schema.prisma`; деньги — Decimal/string + идемпотентность + Serializable-retry; безопасность — helmet, throttler, argon2id, Zod на всех клиентских `@Body`, pino-redact, HMAC на вебхуках; тесты — 62 unit + 9 E2E; CI — 4 обязательных чека + 2 guard'а зелёные, docker-образ собирается.

## 🟡 MEDIUM — частично сделано

| # | Что | Статус |
|---|-----|--------|
| GAP-14 | `GET /admin/kyc/:id` возвращал `{todo:true}` | ✅ Исправлено 2026-08-22: возвращает профиль+документы+`totalDepositedRub` (`kyc-admin.controller.ts`) |
| GAP-15 | ~~NotificationService игнорировал настройки и канал email~~ | ✅ Закрыто в рамках GAP-02: enqueue в очередь `email` с проверкой `user_settings.notificationsEmail`; sentAt проставляет воркер |
| GAP-16 | README врал про `[x]` во всех частях | ✅ Исправлено: честные проценты + ссылка сюда |
| GAP-17 | KYC upload UI есть, но лимит 5000₽ проверяется только на бэке при депозите — сверить с kyc-check.service | ⚠️ API `limit_remaining` готов (`get-kyc-status.use-case.ts`), во фронте не используется → выделено в **GAP-36** (аудит 2026-09-01) |

## 📋 TZ SYNC — расхождения после обновления Part 5 (2026-08-23)

> ТЗ части 1–7 и PAYMENT_OVERVIEW синхронизированы с новой [tz-part-5](tz-part-5-frontend-web.md). Ниже — что **ещё не реализовано в коде**.

| # | Требование ТЗ | Статус кода |
|---|---------------|-------------|
| TZ-01 | `GET /api/v1/geo/config` — методы по гео/валюте | ✅ GeoModule + shared-config geo profiles |
| TZ-02 | MVP валюты: RUB + USDT_TRC20 + BTC; TON/TRX/LTC убраны из релиза | ⚠️ Публичный exchange-rates убран; проверить NOWPayments client |
| TZ-03 | `last_payment_method` на профиле для сортировки кассы | ✅ schema + DepositProfileService; нужна миграция БД |
| TZ-04 | KYC API: `limit_remaining` + `?currency=` | ✅ GetKycStatusUseCase обновлён |
| TZ-05 | Крипто-депозит: зачисление факта, не exact amount | ⚠️ webhook уже uses actually_paid |
| TZ-06 | Launch: `CURRENCY_NOT_SUPPORTED`, кросс-валютный запрет | ✅ LaunchGameUseCase + InsufficientFunds → DepositSheet на web |
| TZ-07 | Frontend web (`apps/web`) по новому Part 5 | ⚠️ Старт: header, sheets, geo/wallet stores, home slot-first |
| TZ-08 | Phase 2 фиат UAH/BYN/KZT/UZS | 📌 GeoConfig готов, fiatLive=false до PSP |
| TZ-09 | Приёмка 90 сек: geo presets, deposit `currency`+`method` | ⚠️ Backend готов; web flow частично (register→launch→deposit) |
| TZ-10 | Register → сразу сессия без email-тупика | ✅ RegisterUseCase + auth store |

## Параллельная разработка — РАЗРЕШЕНО 2026-08-24
Работа второго агента (Copilot) слита: geo-модуль, deposit-profile, web-компоненты (`d7a923d`). Экспорты `shared-config/geo.config.ts` добавлены, два битых относительных пути починены, полный monorepo tsc = 0, всё в main (`8473f59a`).

Продуктовое решение агента (TZ-10): регистрация выдаёт сессию сразу, gate `emailVerified` в LoginUseCase снят, RegisterUseCase переписан (сессия + access-token немедленно); письмо-верификация идёт по очереди как информационное. Если для рынка СНГ верификация обязательна ДО игры — вернуть gate и выдавать сессию после verify-email.

## Environment — особенности этой машины (Android SD-card)

- `/mnt/sdcard` = Android FUSE: **symlinks запрещены** → pnpm не может линковать `.bin`; `pnpm install` падает EACCES. В `.npmrc` добавлен `bin-links=false`.
- Оффлайн-store без registry: `jsonwebtoken`, `@types/multer` недоступны → JWT реализован на node:crypto, multer покрыт временным shim'ом `apps/api/src/types/multer*.d.ts` (удалить после `pnpm add -D @types/multer`).
- **Prisma client в этой среде НЕ сгенерирован** (`prisma generate` требует完整 store) — типы БД проверялись через hoisted-копию; на нормальной Linux-FS выполнить: `pnpm install && pnpm db:generate && pnpm db:migrate`.

## Структура проекта — найдено и исправлено 2026-08-22

| Проблема | Статус |
|---|---|
| `docs/INDEX.md`: битые ссылки на `../tz-part-*.md` (файлы лежат в `docs/`) | ✅ исправлено |
| В корне отсутствовали машинно-читаемые инструкции агента (`AGENTS.md`, `.cursorrules`), хотя `docs/AGENT_INSTRUCTIONS.md` предписывает их создать | ✅ созданы из §1/§2 того же документа |
| Мусор вне git-репо: `/mnt/sdcard/Casino/apps` (пустой), `/mnt/sdcard/Casino/home`, `/mnt/sdcard/Casino/uploads` (старые .txt копии доков от 2026-07-17) | ⚠️ не тронуто — решить владельцу |
| `.env` лежит на диске, но не закоммичен (в git только `.env.example`) | ✅ ок |
| Доки описывали схему Prisma как `prisma/schema/<area>.prisma` и `turbo.json` — в реальности один `schema.prisma` и turbo нет | ✅ Исправлено 2026-08-28: AGENT_INSTRUCTIONS/MODULE_TEMPLATE/.cursorrules приведены к единому `schema.prisma`, упоминания turbo убраны, `events.ts` → `apps/api/src/queues/queue.types.ts` |

## Остаток работ (ревизия 2026-08-28)

1. ~~**GAP-19/20/27** — Throttler + Helmet + argon2-параметры~~ ✅ закрыто 2026-08-30 (`security/gap-19-20-27`).
2. **GAP-18 ✅ / GAP-21 ✅ / GAP-23 ✅** — lockout, Zod и Pino redact закрыты 2026-08-30. **P0 #3 (атомарность денег) и P0 #4 (NOWPayments IPN — канонический sorted-JSON HMAC) закрыты 2026-08-30. E2E закрыт 2026-08-31 (см. GAP-24)**. Осталось: sandbox-прогон NOWPayments перед боевыми ключами.
3. **GAP-08/09 runtime** — сверка sign-порядков с менеджером GitSlotPark + runtime-тест с ключами.
4. **GAP-03/04** — Google/Telegram OAuth: код готов, нужны ключи + runtime-проверка.
5. **Runtime-приёмка** на Linux-FS: `pnpm install && pnpm db:generate && pnpm db:migrate && pnpm dev`; прогон register→login→deposit→launch→admin.
6. Решение по email-верификации (см. заметку о TZ-10 выше).
7. ~~После MVP: GAP-22/24/25/26~~ **2026-09-01: закрыты все четыре** — GAP-22 (4-слойка wallet), GAP-24 (тесты + E2E), GAP-25 (ESLint error-пороги 3/10), GAP-26 (алиасы через `tsc-alias`). ~~Из P2/P3-трекера остаётся только GAP-28~~ **GAP-28 закрыт 2026-09-01 (идемпотентность депозита по external_id)**; остался GAP-30 (возврат `max-lines-per-function` к 60); плюс email-воркер отдельным процессом и rich HTML-шаблоны.
8. **Аудит готовности 2026-09-01 → GAP-31…GAP-38** (раздел выше). Порядок работ:
   **сначала P0** — GAP-31 (миграции: без них деплой на чистую БД невозможен) и GAP-32
   (реферальные выплаты не происходят); **затем P1** — GAP-33 (cron-jobs), GAP-34 (курсы
   из БД), GAP-35 (честный readiness); **потом P2/P3** — GAP-36, GAP-38, GAP-37, GAP-30.
   GAP-32 зависит от GAP-33 (cron), GAP-34 частично зависит от GAP-33 (job обновления курсов).
9. **CI-инфраструктура приведена в порядок 2026-09-01** (PR #20/#21/#23/#24): docker-build
   получил правильный контекст (`casino-platform`, а не корень репо) и `@types/node`/`.npmrc`
   в образе; commitlint на push в main проверяет только свежий squash-коммит; `.gitleaks.toml`
   с allowlist для placeholder-примеров в доках; deploy-job пропускается (notice), пока нет
   `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`. Main зелёный целиком, включая docker-build.
