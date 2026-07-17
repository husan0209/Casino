# Security Baseline – Casino Platform

## Auth
- [x] argon2id, memoryCost 65536, timeCost 3, parallelism 4
- [x] JWT RS256/HS256, access 15m, refresh 30d, rotation
- [x] Refresh token – hash only in DB
- [x] Email verify / password reset – crypto.randomBytes(64)
- [x] Rate limit: /auth/login 10/15min, /auth/register 5/h

## API
- [x] CORS – own domains only
- [x] Helmet / security headers via Nginx
- [x] GlobalExceptionFilter – no stack traces in prod
- [x] Zod validation on all inputs
- [x] Owner check (IDOR prevention) on user-specific endpoints
- [x] RBAC Guard – user / admin / superadmin

## Payments
- [x] Money = string + decimal.js, DB DECIMAL(20,8)
- [x] Idempotency key on every financial op
- [x] Optimistic locking wallet_accounts.version
- [x] All financial ops in prisma.$transaction()
- [x] Webhook signature verification (Rukassa HMAC / NOWPayments IPN)
- [x] Raw callback saved before processing
- [x] Always return 200 OK to provider

## Data
- [x] Passwords never logged
- [x] Tokens / secrets redacted in pino logs
- [x] KYC documents outside public dir, signed route only
- [x] .env in .gitignore, secrets in GitHub Secrets

## Infra
- [x] UFW – allow 22,80,443 only
- [x] fail2ban – ssh + nginx
- [x] SSL Let's Encrypt, auto-renew
- [x] Docker non-root
- [x] PostgreSQL – no public exposure
- [x] Redis – password auth
