# Casino Platform

Online Casino Platform — NestJS + Next.js + Prisma + PostgreSQL + Redis + BullMQ

СНГ, RUB, Rukassa (фиат), NOWPayments (крипто), KYC 5000₽, GGR-share рефералы 5%

## Stack

Backend: NestJS 10 · TypeScript · Prisma 5 · PostgreSQL 16 · Redis 7 · BullMQ · Zod · argon2
Frontend: Next.js 14 App Router · Tailwind · TanStack Query · Zustand · RHF + Zod
Admin: Next.js + TanStack Table + Recharts

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev
```

API http://localhost:3001/api/v1/health
Web http://localhost:3000
Admin http://localhost:3002

Seed admin: superadmin@casino.example.com / dev_superadmin_password_123

## TZ Progress (ревизия 2026-10-02)

> Единственный источник правды по статусу — `docs/IMPLEMENTATION_GAPS.md` (GAP-трекер).
> Снапшот аудита с ревизией каждого пункта — `docs/archive/audit-2026-08-25.md`.
>
> ⚠️ **К запуску не готово.** Аудит 2026-09-01 выявил 8 расхождений (GAP-31…GAP-38);
> закрыты: GAP-31 (миграции), GAP-32/33 (реферальные выплаты + scheduled jobs),
> GAP-34/35 (курсы из БД + честный readiness), GAP-36/37/38 (KYC-лимит во фронте,
> деплой-доки + resource-check, seed fail-closed), GAP-30 (eslint 60) — все 2026-09-02.
>
> **Аудит готовности #2 (2026-09-02): код MVP готов (~85%), приёмка — 0%.**
> Заведены GAP-39…GAP-50, далее GAP-51…GAP-60 (закрыты 2026-09-27…2026-10-02).
> Блокеры запуска: **GAP-46** (runtime-приёмка внешнего
> контура и первый деплой — нужны ключи и VPS) и **GAP-49** (юридика/комплаенс —
> решение владельца). ~~GAP-40~~ (SMTP-пароль: мейлер читает `SMTP_PASS`, а дока
> предписывает `SMTP_PASSWORD`) **закрыт PR #53**: канон `SMTP_PASSWORD`, дубликат убран из
> `env.validation.ts`, прод fail-closed, спек `smtp-mailer.spec.ts`. Инженерный хвост вне
> блокеров — GAP-43 (порядок полей подписи GitSlotPark не подтверждён провайдером).
> Подробно — `docs/IMPLEMENTATION_GAPS.md`.
> Инженерные гейты при этом зелёные: 5 обязательных чеков CI (включая pnpm audit), 2 guard'а
> (`Architecture guards` — G1…G23 и `docs-guard` — D1…D10), собираются все три прод-образа,
> unit + E2E проходят (см. CI).
>
> **Pre-launch hardening (2026-09-04)**: cleanup-sessions cron (мёртвые сессии), индексы
> game_transactions/ledger_entries (GGR-cron без seq-scan), ротация docker-логов (50m×5),
> graceful shutdown (enableShutdownHooks + stop_grace_period 45s), throttle админ-логина (5/мин),
> ErrorBoundary web/admin, security headers + favicon, OAuth-кнопки в UI (Google/Telegram Widget),
> pnpm-audit в CI + Dependabot.

- [x] Часть 1 Foundation – ~85% – monorepo, Prisma schema (31 модель + 31 enum в `packages/database/prisma/schema.prisma`; счёт по `^model `), shared packages, Docker, Nginx — готово
- [~] Часть 2 Auth/Users/KYC/RBAC – ~90% – регистрация (сразу сессия, TZ-10)/логин/JWT refresh-rotation/KYC 5000₽: остаток лимита из API на странице KYC и в депозитном флоу, CTA на верификацию при исчерпании (GAP-36 закрыт 2026-09-02); BullMQ email queue. Google OAuth (code-flow) и Telegram Login Widget реализованы – нужны ключи в env (GAP-03/04 закрыты)
- [~] Часть 3 Wallet & Payments – ~85% – ledger/optimistic locking + сериализация мутаций кошелька: `pg_advisory_xact_lock` + `ReadCommitted`, повтор ×5 (`wallet-transaction-lock.ts:63,130,143-150`; GAP-57 закрыт 2026-09-30 — раньше было Serializable + retry ×3, см. строку GAP-57 ниже); Rukassa/NOWPayments — реальные HTTP-клиенты и HMAC-verify на raw body (GAP-06/07 закрыты 2026-08-24); runtime — нужны боевые ключи; scheduled jobs на месте (истечение депозитов/курсы/напоминания — GAP-33 закрыт 2026-09-02); курсы из БД/кеша потребляются конвертацией (GAP-34 закрыт 2026-09-02, фиат — политические константы)
- [~] Часть 4 Casino Providers – ~60% – Seamless Wallet API + DemoProvider + GitSlotPark-адаптер (GAP-08 закрыт 2026-08-24: агрегатор Pragmatic Play/PG Soft/Amatic/Amusnet, sync каталога — GAP-09); до продакшена — сверка sign-порядков и runtime-тест с ключами
- [x] Часть 5 Frontend Web – ~99% – витрина (last played, бейджи NEW/HOT, лента провайдеров, превью по «i»)/каталог с infinite scroll/избранное/поиск/провайдеры/ЛК (4 вкладки: данные+аватар, безопасность — смена пароля, сессии, настройки)/кошелёк/KYC/история + geo/wallet stores, DepositSheet/LaunchCurrencySheet/WalletSwitcher, play-страница с планкой баланса, SEO (OG/noindex); GAP-52/53 закрыты 2026-09-13; тесты — счёт по spec-файлам (пересчёт 2026-10-02, `find apps/*/test apps/*/src -name '*.spec.ts*' -o -name '*.test.ts*' | wc -l`): api 57 (41 в `apps/api/test` + 16 внутри `apps/api/src/modules`), web 18, admin 3; интеграционные и E2E-спеки на БД выполняются в CI (GAP-44 + контракты casino.api/users.api + desktop-nav). Точное число тест-кейсов без прогона `pnpm test` не считается: прежние суммы этой строки (472 unit/integration, 410 локально, 177 web, 11 admin) и сумма в `docs/QA_CHECKLIST.md` (403) устарели после #131, где добавлен canary `apps/api/test/architecture.canary.spec.ts`. Десктоп-иконпанель §4.5 (pin/hover), поиск в хедере + Ctrl/⌘K, last played и провайдеры в поиске, auth-страницы без казино-обвязки §4.7 (GAP-54 закрыт 2026-09-14). URL-фильтры каталога + сортировка + сброс, чипы/полки главной (§6.1/§7), ошибки запуска экранами + WithdrawSheet (§8.4/§10.3), история транзакций /wallet/transactions с фильтрами (§11) и история ставок с фильтрами и агрегатами по валютам (§12), performance-хвост §22 (обложки через next/image с allowlist CDN-хостов, ISR главной 60с, dynamic import iframe, content-visibility вместо библиотеки-виртуализации, prefetch по наведению) и bottom-sheet «Фильтры» на телефоне (§7) — закрыто 2026-09-14/15 в GAP-55. Попутно исправлены два неработающих места: фиат-вывод (destination объектом → 422) и snake_case в GameDto (не рендерились бейджи NEW/HOT и кнопка «Демо»). Статус заявки на вывод в истории (§11) закрыт 2026-09-16: заявка получает id до блокировки, проводки несут ссылку, эндпоинт добирает статусы одним запросом (старые строки — null, не выдумываем). Капча после 5 неудач (§5.2) — Cloudflare Turnstile, fail-open при сбое провайдера, порог 5, механизм выключен без обоих ключей; код+13 тестов готовы, живая проверка siteverify — в GAP-46 (нужны ключи и публичный домен). GAP-55 закрыт целиком
- [~] Часть 6 Admin/Support/Referrals – ~70% – Backend API полный (users/finance/support/referrals/notifications+queue/dashboard metrics·charts·events/batch withdrawals). Admin frontend реализован (20 страниц по `find apps/admin/src -name 'page.tsx'`: логин + 13 разделов дашборда — живой дашборд с графиками, users, withdrawals batch, transactions, payments, KYC/support/games/providers/referrals/audit/admins/settings — и 6 страниц партнёрки из ч.8). GGR-share выплачивается: cron `referral-daily` + ручной `POST /admin/referrals/run-daily` (GAP-32 закрыт 2026-09-02). Осталось: runtime-проверка с ключами (OAuth, GitSlotPark) на Linux-FS
- [~] Часть 7 DevOps – ~85% – docker-compose.prod, nginx, GitHub Actions CI: 5 чеков (включая pnpm audit) + deploy-job (после зелёного CI, skip без VPS-секретов), migrate deploy на деплое (GAP-31), честный readiness + healthcheck на /health/ready (GAP-35), первичная инициализация админа задокументирована + seed fail-closed в production (GAP-38), resource-check.sh (GAP-37). Осталось: runtime-деплой на VPS с секретами
- [~] Часть 8 Affiliate (партнёрская программа) – код есть, приёмки 0% – добавлено 2026-09-29, в этом списке раньше не числилось. Модуль `apps/api/src/modules/affiliate/**` (44 ts-файла, 4 слоя + facade, регистрация в `app.module.ts`), 2 миграции (`20260929171538_affiliate_program_initial`, `20260929172043_affiliate_click_relation`), трекинг-редирект `GET /go/:code`, кабинет партнёра в web (`apps/web/src/app/affiliate`: dashboard/links/commissions/players), 6 страниц админки (`apps/admin/src/app/dashboard/affiliate`), 12 spec-файлов модуля. **Не закрыто по ТЗ ч.8 «Этап 7 — Интеграция»:** (1) атрибуция не вызывается из `oauth-user-provisioning.service` — партнёр теряется при регистрации через Google/Telegram (вызов есть только из `register.use-case.ts:69`); (2) квалификация идёт суточным прогоном (`QualifyAttributionsUseCase`), а не по событию завершения депозита; (3) нет спеков на `affiliate-daily.job`, `tracking.controller`, `affiliate-auth.guard`. Runtime-приёмка — GAP-46. Статус источника: `docs/tz-part-8-affiliate-program.md` (v1.0 «реализуется», 79 пунктов приёмки отмечены `[x]`, 4 открыты)

> Подробнее см. `docs/IMPLEMENTATION_GAPS.md` (открытые блокеры запуска: GAP-46 runtime-приёмка, GAP-49 юридика) и раздел Money safety ниже.
>
> **GAP-57 закрыт 2026-09-30** — конкурентные мутации одного кошелька сериализованы
> advisory-локом (`pg_advisory_xact_lock` + ReadCommitted): успех ставок на 100 VU
> вырос с 30,6% до **100%**, деньги сошлись, кошельки не блокируют друг друга
> (10 игроков → 165 rps). Отчёт — `docs/archive/load-test-2026-09-30.md`.

## Money safety

- DB: `DECIMAL(20,8)`
- Code: `string` + `decimal.js`
- API: string
- NEVER `number`/`float`
- Idempotency key on every financial op
- Optimistic locking `wallet_accounts.version`, повтор при конфликте ×5 (`MAX_ATTEMPTS`, `wallet-transaction-lock.ts:63`)
- Все money-мутации — одна транзакция на кошелёк: `pg_advisory_xact_lock` + `ReadCommitted` (`wallet-transaction-lock.ts:130,143-150`). Раньше было `Serializable` + retry ×3 — схема изменена по GAP-57 (2026-09-30), гард G7 с тех пор ничего не проверяет (см. `docs/QUALITY_GATES.md` §3.2)

## Payment security (fail-closed)

- **Production**: Requires `RUKASSA_SECRET_KEY` + `NOWPAYMENTS_IPN_SECRET` for startup
- **No placeholders in production**: Dev prefixes (`dev_*`, `your_*`, `change_me`) are rejected
- **Demo provider disabled by default**: Requires explicit `DEMO_PROVIDER_ENABLED=true` + dev/staging only
- **Stub verification throws in production**: Prevents accidental acceptance of unverified payments
- **Signature verification**: HMAC-SHA256 (Rukassa), HMAC-SHA512 (NOWPayments), constant-time comparison
- See `docs/SECURITY_BASELINE.md` for detailed threat model

## Docs

`docs/` — 36 markdown-файлов + `docs/archive/` (4 снапшота аудитов). Полная карта — **`docs/INDEX.md`**.
Ключевые: ARCHITECTURE, STACK, API_CONVENTIONS, CONVENTIONS, SECURITY_BASELINE, SECURITY_CHECKLIST (честный статус), SECURITY_FIXES, PAYMENT_OVERVIEW, PROVIDER_INTEGRATION_STRATEGY, ENVIRONMENT_VARIABLES, AI_DEVELOPMENT_RULES, MODULE_BOUNDARIES, MODULE_TEMPLATE, AGENT_INSTRUCTIONS, IMPLEMENTATION_GAPS (GAP-трекер), TECH_DEBT (реестр ratchet-долга G16–G21), QUALITY_GATES, BRANCH_PROTECTION, QA_CHECKLIST, DEPLOY, USER_FLOW_FIRST_90_SECONDS + 9 файлов ТЗ (`tz-part-1…8` и `tz-part-5.1` — дизайн)

## Deploy

See `docs/DEPLOY.md` – Hetzner CX41, Docker Compose prod, Let's Encrypt, CI/CD via GitHub Actions SSH.
