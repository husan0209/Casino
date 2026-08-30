# Security Checklist – Casino Platform

> **Статус:** ревизия 2026-08-28 по результатам аудита (снапшот: [`archive/audit-2026-08-25.md`](./archive/audit-2026-08-25.md)).
> Открытые пункты ведут в [`IMPLEMENTATION_GAPS.md`](./IMPLEMENTATION_GAPS.md) (GAP-18..28).
> **Правило:** `[x]` ставится только если указано подтверждение (файл:строка, guard ID или ручная проверка с датой). Пустое подтверждение = пункт не выполнен.

**Легенда:** ✅ подтверждено · ⚠️ частично / требует ручной проверки · ❌ не выполнено → GAP-NN

## Auth

| Пункт | Статус | Подтверждение |
|-------|--------|---------------|
| argon2id, memoryCost 65536, timeCost 3, parallelism 4 | ⚠️ | тип argon2id ✅, но параметры не заданы (дефолты ~19MiB/2/1) → **GAP-27** (`password-hasher.service.ts:7`) |
| JWT HS256, access 15m, refresh 30d, rotation | ✅ | `jwt.service.ts` (HS256 на node:crypto), env-дефолты `15m`/`30d` (`env.validation.ts:34-35`) |
| Refresh token – hash only in DB | ✅ | `hashRefreshToken` через `crypto.createHash('sha256')` (аудит 2026-08-25 §5) |
| Email verify / password reset – crypto.randomBytes(64) | ⚠️ | механизм реализован (GAP-01, токен 24ч); длина/энтропия — сверить при runtime-приёмке |
| Rate limit: /auth/login 10/15min, /auth/register 5/h | ❌ | nginx `10r/m` есть (1 мин, не 15); app-level отсутствует → **GAP-19** |
| Account lockout 10/15min | ❌ | **GAP-18** |

## API

| Пункт | Статус | Подтверждение |
|-------|--------|---------------|
| CORS – own domains only | ✅ | `main.ts:42` `enableCors`, origins из env |
| Helmet / security headers | ⚠️ | Nginx headers ✅ (`infra/nginx/`); app-level helmet отсутствует → **GAP-20** |
| GlobalExceptionFilter – no stack traces in prod | ✅ | `global-exception.filter.ts` (типизация details исправлена, ревизия N12) |
| Zod validation on all inputs | ❌ | forgot-password и payments-контроллеры без валидации → **GAP-21** |
| Owner check (IDOR) on user-specific endpoints | ⚠️ | manual — систематическая проверка не проводилась |
| RBAC Guard – user / admin / superadmin | ✅ | `roles.guard.ts`, `admin-auth.guard.ts`, `optional-auth.guard.ts` |

## Payments

| Пункт | Статус | Подтверждение |
|-------|--------|---------------|
| Money = string + decimal.js, DB DECIMAL(20,8) | ✅ | `packages/shared-types/src/money.ts`, `schema.prisma` |
| Idempotency key on every financial op | ✅ | `wallet.ledger.prisma.ts` (все операции с `idempotencyKey`); nuance формата депозита → GAP-28 (P3) |
| Optimistic locking wallet_accounts.version | ✅ | `version: {increment: 1}` + retry ×3 (ревизия H1) |
| All financial ops in prisma.$transaction() | ✅ | `isolationLevel: 'Serializable'` (`wallet.ledger.prisma.ts:121`, ревизия H1) |
| Webhook signature verification | ✅ | HMAC на **raw body** (ревизия N5: `main.ts` verify + контроллер передаёт `rawBody`) |
| Raw callback saved before processing | ✅ | `process-rukassa-webhook.use-case.ts` — «Store the EXACT raw body bytes» |
| Always return 200 OK to provider | ✅ | вебхук-контроллеры (`payments-webhook.controller.ts`) |

## Data

| Пункт | Статус | Подтверждение |
|-------|--------|---------------|
| Passwords never logged | ⚠️ | Nest Logger без redact — гарантий нет → **GAP-23** |
| Tokens / secrets redacted in pino logs | ❌ | pino не подключён → **GAP-23** |
| KYC documents outside public dir, signed route only | ⚠️ | хранение `./uploads/kyc` ✅ (вне public); подписанная выдача — manual check |
| .env in .gitignore, secrets in GitHub Secrets | ✅ | аудит 2026-08-25 §5 |

## Infra

| Пункт | Статус | Подтверждение |
|-------|--------|---------------|
| UFW – allow 22,80,443 only | ⚠️ | manual — `infra/scripts/vps_init.sh`, проверяется при деплое VPS |
| fail2ban – ssh + nginx | ⚠️ | manual — `infra/scripts/vps_init.sh` |
| SSL Let's Encrypt, auto-renew | ⚠️ | manual — `infra/scripts/ssl_init.sh` |
| Docker non-root | ✅ (prod) | `USER node` во всех `*.prod.Dockerfile` (ревизия N11); dev-образы root by design — [`infra/docker/README.md`](../infra/docker/README.md) |
| PostgreSQL – no public exposure | ✅ | аудит 2026-08-25 §5: postgres не expose |
| Redis – password auth | ✅ | аудит 2026-08-25 §5: `--requirepass ${REDIS_PASSWORD}` |

---

## Процессные уровни защиты

| Уровень | Статус | Подтверждение |
|---------|--------|---------------|
| CI: lint/typecheck/test/build без `\|\| true` | ✅ | `.github/workflows/ci.yml` (убрано 2026-08-28) |
| CI: architecture guards G1–G12 | ✅ | `.github/workflows/architecture-guards.yml` |
| Branch protection в GitHub | ❌ | не настраивается кодом — вручную по [`BRANCH_PROTECTION.md`](./BRANCH_PROTECTION.md) |
| Pre-commit (gitleaks + lint-staged) | ⚠️ | хуки есть, но на FAT/sdcard не срабатывают (filemode=false) — `scripts/setup-hooks.sh` |
| Pre-push (typecheck + tests) | ⚠️ | SKIP на FAT/sdcard — `.husky/pre-push` |

> **Обновлено:** 2026-08-28. Следующая ревизия — после закрытия GAP-18..21 (P0/P1 security).
