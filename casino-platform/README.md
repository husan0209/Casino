# Casino Platform

Online Casino Platform — NestJS + Next.js + Prisma + PostgreSQL + Redis + BullMQ

СНГ, RUB, Rukassa (фиат), NOWPayments (крипто), KYC 5000₽, GGR-share рефералы 5%

## Stack
Backend: NestJS 11 · TypeScript · Prisma 5 · PostgreSQL 16 · Redis 7 · BullMQ · Zod · argon2
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

## TZ Progress (ревизия 2026-09-01)

> Единственный источник правды по статусу — `docs/IMPLEMENTATION_GAPS.md` (GAP-трекер).
> Снапшот аудита с ревизией каждого пункта — `docs/archive/audit-2026-08-25.md`.
>
> ⚠️ **К запуску не готово.** Аудит 2026-09-01 выявил 8 расхождений (GAP-31…GAP-38);
> закрыты: GAP-31 (миграции), GAP-32/33 (реферальные выплаты + scheduled jobs),
> GAP-34/35 (курсы из БД + честный readiness), GAP-36/37/38 (KYC-лимит во фронте,
> деплой-доки + resource-check, seed fail-closed) — все 2026-09-02. Ключевой остаток:
> runtime-проверки с боевыми ключами и GAP-30 (eslint 60).
> Инженерные гейты при этом зелёные: 4 обязательных чека CI + 2 guard'а, docker-образ собирается,
> 62 unit + 9 E2E проходят.
- [x] Часть 1 Foundation – ~85% – monorepo, Prisma schema (19 таблиц), shared packages, Docker, Nginx — готово
- [~] Часть 2 Auth/Users/KYC/RBAC – ~90% – регистрация (сразу сессия, TZ-10)/логин/JWT refresh-rotation/KYC 5000₽: остаток лимита из API на странице KYC и в депозитном флоу, CTA на верификацию при исчерпании (GAP-36 закрыт 2026-09-02); BullMQ email queue. Google OAuth (code-flow) и Telegram Login Widget реализованы – нужны ключи в env (GAP-03/04 закрыты)
- [~] Часть 3 Wallet & Payments – ~85% – ledger/optimistic locking + Serializable/retry; Rukassa/NOWPayments — реальные HTTP-клиенты и HMAC-verify на raw body (GAP-06/07 закрыты 2026-08-24); runtime — нужны боевые ключи; scheduled jobs на месте (истечение депозитов/курсы/напоминания — GAP-33 закрыт 2026-09-02); курсы из БД/кеша потребляются конвертацией (GAP-34 закрыт 2026-09-02, фиат — политические константы)
- [~] Часть 4 Casino Providers – ~60% – Seamless Wallet API + DemoProvider + GitSlotPark-адаптер (GAP-08 закрыт 2026-08-24: агрегатор Pragmatic Play/PG Soft/Amatic/Amusnet, sync каталога — GAP-09); до продакшена — сверка sign-порядков и runtime-тест с ключами
- [~] Часть 5 Frontend Web – ~75% – витрина/ЛК/кошелёк/KYC/история + geo/wallet stores, DepositSheet/LaunchCurrencySheet, play-страница; полный 90-сек флоу частично (TZ-07/09)
- [~] Часть 6 Admin/Support/Referrals – ~70% – Backend API полный (users/finance/support/referrals/notifications+queue/dashboard metrics·charts·events/batch withdrawals). Admin frontend реализован (13 страниц: JWT-логин, живой дашборд с графиками, withdrawals batch, KYC/support/games/audit/admins/settings). GGR-share выплачивается: cron `referral-daily` + ручной `POST /admin/referrals/run-daily` (GAP-32 закрыт 2026-09-02). Осталось: runtime-проверка с ключами (OAuth, GitSlotPark) на Linux-FS
- [~] Часть 7 DevOps – ~85% – docker-compose.prod, nginx, GitHub Actions CI: 4 чека + deploy-job (после зелёного CI, skip без VPS-секретов), migrate deploy на деплое (GAP-31), честный readiness + healthcheck на /health/ready (GAP-35), первичная инициализация админа задокументирована + seed fail-closed в production (GAP-38), resource-check.sh (GAP-37). Осталось: runtime-деплой на VPS с секретами

> Подробнее см. `docs/IMPLEMENTATION_GAPS.md` (открытые GAP-08..17, GAP-30..38) и раздел Money safety ниже.

## Money safety
- DB: `DECIMAL(20,8)`
- Code: `string` + `decimal.js`
- API: string
- NEVER `number`/`float`
- Idempotency key on every financial op
- Optimistic locking `wallet_accounts.version`, retry ×3
- All financial ops in `prisma.$transaction()`

## Payment security (fail-closed)
- **Production**: Requires `RUKASSA_SECRET_KEY` + `NOWPAYMENTS_IPN_SECRET` for startup
- **No placeholders in production**: Dev prefixes (`dev_*`, `your_*`, `change_me`) are rejected
- **Demo provider disabled by default**: Requires explicit `DEMO_PROVIDER_ENABLED=true` + dev/staging only
- **Stub verification throws in production**: Prevents accidental acceptance of unverified payments
- **Signature verification**: HMAC-SHA256 (Rukassa), HMAC-SHA512 (NOWPayments), constant-time comparison
- See `docs/SECURITY_BASELINE.md` for detailed threat model

## Docs

`docs/` — 30 файлов + `docs/archive/` (снапшоты аудитов). Полная карта — **`docs/INDEX.md`**.
Ключевые: ARCHITECTURE, STACK, API_CONVENTIONS, CONVENTIONS, SECURITY_BASELINE, SECURITY_CHECKLIST (честный статус), PAYMENT_OVERVIEW, PROVIDER_INTEGRATION_STRATEGY, ENVIRONMENT_VARIABLES, AI_DEVELOPMENT_RULES, MODULE_BOUNDARIES, MODULE_TEMPLATE, AGENT_INSTRUCTIONS, IMPLEMENTATION_GAPS (GAP-трекер), QUALITY_GATES, BRANCH_PROTECTION, QA_CHECKLIST, DEPLOY, USER_FLOW_FIRST_90_SECONDS + 7× tz-part

## Deploy
See `docs/DEPLOY.md` – Hetzner CX41, Docker Compose prod, Let's Encrypt, CI/CD via GitHub Actions SSH.
