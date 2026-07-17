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

## TZ Progress
- [x] Часть 1 Foundation – monorepo, Prisma schema (19 таблиц), shared packages, Docker, Nginx
- [x] Часть 2 Auth/Users/KYC/RBAC – email/Google/Telegram OAuth, JWT 15m/30d refresh rotation, UserProfile, Sessions, KYC 5000₽ limit, Admin + AuditLog
- [x] Часть 3 Wallet & Payments – ledger optimistic locking, Rukassa fiat, NOWPayments crypto, withdrawals lock/unlock/confirm, exchange_rates
- [x] Часть 4 Casino Providers – Seamless Wallet API (authenticate/balance/bet/win/rollback), ProviderAdapter, DemoProvider, catalog, favorites
- [x] Часть 5 Frontend Web – Premium Dark UI, каталог с фильтрами, ЛК, кошелёк, KYC upload, история ставок, deposit/withdraw UI
- [x] Часть 6 Admin/Support/Referrals – Admin panel layout, Support tickets (with internal notes), Referral GGR-share daily cron, Notifications
- [x] Часть 7 DevOps – docker-compose.prod, Nginx SSL + rate limits + security headers, GitHub Actions CI/CD, VPS init (UFW/fail2ban), backup script, QA checklist

## Money safety
- DB: `DECIMAL(20,8)`
- Code: `string` + `decimal.js`
- API: string
- NEVER `number`/`float`
- Idempotency key on every financial op
- Optimistic locking `wallet_accounts.version`, retry ×3
- All financial ops in `prisma.$transaction()`

## Docs
`docs/` – 20 files: ARCHITECTURE, STACK, API_CONVENTIONS, CONVENTIONS, SECURITY_BASELINE, PAYMENT_OVERVIEW, PROVIDER_INTEGRATION_STRATEGY, ENVIRONMENT_VARIABLES, AI_DEVELOPMENT_RULES, MODULE_BOUNDARIES, MODULE_TEMPLATE, AGENT_INSTRUCTIONS, SECURITY_CHECKLIST, QA_CHECKLIST, DEPLOY, + 7× tz-part

## Deploy
See `docs/DEPLOY.md` – Hetzner CX41, Docker Compose prod, Let's Encrypt, CI/CD via GitHub Actions SSH.
