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

## TZ Progress (честный статус на 2026-08-22)
- [x] Часть 1 Foundation – ~85% – monorepo, Prisma schema (19 таблиц), shared packages, Docker, Nginx — готово
- [~] Часть 2 Auth/Users/KYC/RBAC – ~85% – регистрация (сразу сессия, TZ-10)/логин/JWT refresh-rotation/KYC 5000₽ + limit_remaining; BullMQ email queue. Google OAuth (code-flow) и Telegram Login Widget реализованы – нужны ключи в env (GAP-03/04 закрыты)
- [~] Часть 3 Wallet & Payments – ~75-80% – ledger/optimistic locking, Rukassa/NOWPayments verify есть, но `createPayment` в production кидает `NOT_IMPLEMENTED` (только stub в dev)
- [~] Часть 4 Casino Providers – ~40% – Seamless Wallet API + DemoProvider только. Реальных провайдеров нет (`apps/api/src/modules/casino/infrastructure/providers/provider-adapter.factory.ts:32`)
- [~] Часть 5 Frontend Web – ~75% – витрина/ЛК/кошелёк/KYC/история + geo/wallet stores, DepositSheet/LaunchCurrencySheet, play-страница; полный 90-сек флоу частично (TZ-07/09)
- [~] Часть 6 Admin/Support/Referrals – ~50% – Backend API полный (users/finance/support/referrals/notifications+queue/dashboard metrics·charts·events/batch withdrawals). Admin frontend реализован (13 страниц: JWT-логин, живой дашборд с графиками, withdrawals batch, KYC/support/games/audit/admins/settings). Осталось: реальные провайдеры игр, OAuth, runtime-проверка на Linux-FS
- [~] Часть 7 DevOps – ~60% – docker-compose.prod, nginx, GitHub Actions CI – скелет есть, VPS init/backup – скрипты есть

> Подробнее см. `docs/IMPLEMENTATION_GAPS.md` и раздел Money safety ниже.

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
`docs/` – 20 files: ARCHITECTURE, STACK, API_CONVENTIONS, CONVENTIONS, SECURITY_BASELINE, PAYMENT_OVERVIEW, PROVIDER_INTEGRATION_STRATEGY, ENVIRONMENT_VARIABLES, AI_DEVELOPMENT_RULES, MODULE_BOUNDARIES, MODULE_TEMPLATE, AGENT_INSTRUCTIONS, SECURITY_CHECKLIST, QA_CHECKLIST, DEPLOY, + 7× tz-part

## Deploy
See `docs/DEPLOY.md` – Hetzner CX41, Docker Compose prod, Let's Encrypt, CI/CD via GitHub Actions SSH.
