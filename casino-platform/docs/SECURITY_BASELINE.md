---
title: Security Baseline
description: Базовые security-правила casino-platform на всех уровнях
status: living document
last_updated: 2026-06-19
---

# Security Baseline

> **Назначение:** Сводка security-требований. Каждый новый код должен соответствовать этому baseline. Отступления — только с явным обоснованием.

---

## 1. Целевые угрозы

| Угроза | Где |
|--------|-----|
| **Credential stuffing** | Login endpoint |
| **Brute-force пароля** | Login |
| **Mass registration** | Register |
| **Privilege escalation** | Admin endpoints |
| **Financial fraud** | Wallet, payments |
| **Webhook spoofing** | Provider callbacks |
| **Token replay** | JWT, refresh tokens |
| **Race conditions** | Wallet credits |
| **IDOR** | User-specific endpoints |
| **XSS** | User profile fields |
| **CSRF** | Cookie auth flows |

---

## 2. Authentication & Passwords

### 2.1. Argon2id параметры

```typescript
import { argon2id } from 'hash-wasm'

const HASH_OPTIONS = {
  algorithm: 'argon2id' as const,
  memory: 65536,    // 64 MB
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
}

async function hashPassword(plain: string): Promise<string> {
  return argon2id({
    password: plain,
    salt: crypto.randomBytes(16),
    ...HASH_OPTIONS,
  })
}
```

### 2.2. Password Policy

Минимум 8 символов, минимум 1 цифра.

```typescript
const passwordSchema = z.string()
  .min(8, 'Минимум 8 символов')
  .regex(/\d/, 'Минимум 1 цифра')
```

Frontend — показывать strength indicator (weak / medium / strong).

### 2.3. Account Lockout

После 10 неудачных login за 15 минут — блокировка на 30 минут.

Хранить в `users.failed_login_attempts` + `users.locked_until`.

### 2.4. Безопасное хранение

- Пароли — **argon2id хеш**
- Refresh tokens — **SHA-256 хеш** в БД
- Reset/verify токены — **crypto.randomBytes(32)**, хранить хеш

```typescript
auth.generateRefreshToken = () => crypto.randomBytes(64).toString('hex')
auth.hashRefreshToken = (token: string) => 
  crypto.createHash('sha256').update(token).digest('hex')
```

---

## 3. JWT

### 3.1. Секреты

- ≥ **64 символов** (`openssl rand -hex 64`)
- Различные для access и refresh
- Ротация при компрометации (`invalidate all sessions`)

### 3.2. Algorithm

**MVP:** HS256 (HMAC SHA-256)
**При росте:** RS256 (RSA) — public key для verify без secret sharing

### 3.3. Claims

```typescript
interface JwtPayload {
  sub: string         // userId
  email: string
  role: 'user' | 'admin' | 'superadmin'
  aud: 'user' | 'admin'  // разные audiences для пользователей и админов
  iss: 'casino-platform'
  iat: number
  exp: number         // short-lived (15 минут для access)
  jti: string         // unique token id
}
```

### 3.4. Refresh Token Rotation

```typescript
async refresh(input: RefreshInput) {
  const oldTokenHash = hashRefreshToken(input.refreshToken)
  
  // 1. Найти session
  const session = await this.sessionRepo.findByTokenHash(oldTokenHash)
  if (!session) throw new InvalidTokenError()
  if (session.expiresAt < new Date()) throw new TokenExpiredError()
  
  // 2. ATOMIC: удалить старую и создать новую
  return this.prisma.$transaction(async (tx) => {
    await tx.session.delete({ where: { id: session.id } })
    
    const newSession = await tx.session.create({
      data: {
        userId: session.userId,
        tokenHash: 'pending',  // заполним после генерации
        expiresAt: addDays(new Date(), 30),
      },
    })
    
    const newRefreshToken = generateRefreshToken()
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken)
    
    await tx.session.update({
      where: { id: newSession.id },
      data: { tokenHash: newRefreshTokenHash },
    })
    
    return {
      accessToken: generateAccessToken(...),
      refreshToken: newRefreshToken,
    }
  })
}
```

---

## 4. Rate Limiting

### 4.1. Nginx уровень

```nginx
limit_req_zone $binary_remote_addr zone=api_general:10m rate=60r/m;
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=webhooks:10m rate=100r/m;

# Auth endpoints
location /api/v1/auth/ {
    limit_req zone=auth burst=5 nodelay;
}

# Webhook endpoints
location /api/v1/payments/webhooks/ {
    limit_req zone=webhooks burst=50 nodelay;
}

# General API
limit_req zone=api_general burst=20 nodelay;
```

### 4.2. App-level (ThrottlerModule)

```typescript
@Module({
  imports: [
    ThrottlerModule.forRoot([{
      name: 'short',
      ttl: 1000,    // 1 sec
      limit: 3,     // 3 req/sec (для login)
    }, {
      name: 'medium',
      ttl: 60000,   // 1 min
      limit: 60,    // 60 req/min (general API)
    }]),
  ],
})

// Использование в controllers
@Throttle({ short: { limit: 5, ttl: 1000 } })
@Post('login')
async login() { ... }
```

### 4.3. Стратегия

- **Aggressive:** auth endpoints, KYC upload, withdrawal request
- **Medium:** game launch, deposit create
- **Loose:** browsing (catalog, history, static data)

---

## 5. CSRF & Same-Origin

### 5.1. Решение для MVP: Bearer Auth + CORS

- Cookies НЕ используются для пользователей (только httpOnly для refresh если нужно)
- Bearer JWT в Authorization header
- CORS строго ограничен

```typescript
app.enableCors({
  origin: [process.env.APP_URL, process.env.ADMIN_URL],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: false,  // важно для token-based flow
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key'],
})
```

### 5.2. Admin (если используются cookies)

Двойная submit CSRF token или SameSite=Strict cookies.

---

## 6. Security Headers (Nginx + Helmet)

### 6.1. Nginx

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

# HSTS (только HTTPS)
add_header Strict-Transport-Security "max-age=63072000" always;
```

### 6.2. CSP

```nginx
add_header Content-Security-Policy "
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://telegram.org;
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    font-src 'self';
    connect-src 'self' wss://casino.example.com;
    frame-src 'self' https:;
" always;
```

**⚠️⚠️⚠️ ВНИМАНИЕ ⚠️⚠️⚠️**

`'unsafe-inline'` и `'unsafe-eval'` используются потому что провайдеры казино требуют iframe с inline-скриптами. Для более строгой CSP нужны nonce-based скрипты. После MVP — переход на nonce.

### 6.3. Helmet (NestJS)

```typescript
app.use(helmet({
  contentSecurityPolicy: false,  // CSP уже в Nginx
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
```

---

## 7. File Upload Security

### 7.1. Multer Configuration

```typescript
import multer from 'multer'
import crypto from 'crypto'
import path from 'path'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_SIZE = 10 * 1024 * 1024  // 10 MB

const upload = multer({
  storage: multer.diskStorage({
    destination: process.env.UPLOAD_DIR,
    filename: (req, file, cb) => {
      const randomName = crypto.randomBytes(16).toString('hex')
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `${randomName}${ext}`)
    },
  }),
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new ValidationError('Invalid file type'))
    }
  },
})
```

### 7.2. Хранение

- **Никогда** в публичной директории
- Скачивание через signed URL с проверкой прав (пользователь видит только свои документы)

### 7.3. MIME Spoofing защита

Не доверять только `Content-Type` / extension — для KYC документов использовать дополнительные проверки (magic bytes).

---

## 8. Webhook Signature Verification

### 8.1. Rukassa

```typescript
function verifyRukassaSignature(payload: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', env.RUKASSA_SECRET_KEY)
    .update(payload)
    .digest('hex')
  
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex'),
  )
}
```

**Алгоритм при webhook:**

```
1. Verify signature — throw InvalidSignatureError if invalid
2. Save raw callback to payment_callbacks table (BEFORE processing)
3. Try find existing payment_request by external_id
4. If duplicate — return 200 OK (idempotent)
5. Process: credit wallet, send notification
6. Return 200 OK
```

### 8.2. NOWPayments

```typescript
function verifyNowPaymentsSignature(body: string, signature: string): boolean {
  const hmac = crypto.createHmac('sha512', env.NOWPAYMENTS_IPN_SECRET)
    .update(body)
    .digest('hex')
  
  return crypto.timingSafeEqual(
    Buffer.from(hmac, 'hex'),
    Buffer.from(signature, 'hex'),
  )
}
```

### 8.3. Google OAuth

Проверка `id_token` через Google's JWKS endpoint.

### 8.4. Telegram Login

Проверка `hash` поля с использованием bot token как HMAC ключ.

---

## 9. Input Validation

### 9.1. Whitelisting через ValidationPipe

```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,         // удаляет поля вне DTO
  forbidNonWhitelisted: true,  // 400 если есть лишние поля
  transform: true,
  transformOptions: {
    enableImplicitConversion: false,
  },
}))
```

### 9.2. Zod schemas для сложной валидации

```typescript
const depositSchema = z.object({
  currency: z.enum(['RUB']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount format')
    .refine(v => new Decimal(v).gt(100), 'Минимум 100 RUB')
    .refine(v => new Decimal(v).lte(500000), 'Максимум 500 000 RUB'),
  method: z.enum(['card', 'sbp', 'p2p']),
  idempotencyKey: z.string().min(10).max(128),
})
```

### 9.3. Sanitization

НЕ нужна при правильном использовании:

- Parameterized queries (Prisma делает сам)
- Не используется SQL через string concatenation
- React автоматически экранирует интерполированные значения

НО:

- HTML от пользователя (bio, support messages) — sanitize через `DOMPurify` или экранирование на render

---

## 10. Secrets Management

### 10.1. Где хранить secrets

| Где | Что |
|-----|-----|
| **GitHub Secrets** | CI/CD (VPS_SSH_KEY, DEPLOY_TOKEN) |
| **/home/deploy/.env.production** | App secrets, rotated через `openssl rand` |
| **Никогда** в git | .env, .env.local, .env.production |

### 10.2. .gitignore (обязательно)

```gitignore
# .gitignore
.env
.env.local
.env.production
.env.*.local
*.pem
*.key
*.p12
*.pfx
letsencrypt/
.secrets/
```

### 10.3. Генерация

```bash
# JWT secrets
openssl rand -hex 64

# DB password
openssl rand -base64 32 | tr -d '/+='

# Redis password
openssl rand -hex 32
```

### 10.4. Ротация

| Secret | Период ротации |
|--------|---------------|
| JWT secrets | При компрометации (force logout all) |
| DB password | Раз в 90 дней |
| API keys (providers) | По требованию провайдера |
| Admin passwords | Раз в 90 дней |

---

## 11. Database Security

### 11.1. Два пользователя

```
casino_prod_user        — application (SELECT, INSERT, UPDATE, DELETE)
casino_migration_user   — migrations (всё включая CREATE/DROP/ALTER)
```

```sql
-- Application user (для runtime)
CREATE USER casino_prod_user WITH PASSWORD 'secret';
GRANT CONNECT ON DATABASE casino_prod TO casino_prod_user;
GRANT USAGE ON SCHEMA public TO casino_prod_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO casino_prod_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO casino_prod_user;

-- Migration user (только для migrate deploy)
CREATE USER casino_migration_user WITH PASSWORD 'secret';
GRANT ALL PRIVILEGES ON DATABASE casino_prod TO casino_migration_user;
```

### 11.2. НЕ открывать PostgreSQL наружу

В `docker-compose.prod.yml` НЕ публиковать `5432`. Только внутри `casino-network`.

### 11.3. Row-Level Security (опционально)

Не использовать на MVP — добавить если будет multi-tenant или admin access к user data.

### 11.4. Connection Pooling

- pgbouncer в transaction mode (если нагрузка вырастет)
- Default Prisma pool size: 10 connections

---

## 12. Logging Restrictions

### 12.1. Что НЕЛЬЗЯ логировать

| Поле | Почему |
|------|--------|
| Пароли (даже хеши) | Атакующий получит материал для offline cracking |
| Refresh tokens | Полная компрометация сессии |
| API keys / secrets | Прямая эксплуатация |
| Полные номера карт | PCI DSS violation |
| KYC документы в любом виде | GDPR + privacy |
| Bodies запросов с credentials | Mass credential leak |

### 12.2. Что маскировать при логировании

```typescript
function maskCardNumber(card: string): string {
  // 4111111111111234 → **** **** **** 1234
  return card.replace(/\d(?=\d{4})/g, '*').padStart(19, '*')
}

function maskEmail(email: string): string {
  // user@example.com → u***@example.com
  const [local, domain] = email.split('@')
  return `${local[0]}***@${domain}`
}

function maskWalletAddress(addr: string): string {
  // TXyz123abc... → TXyz...abc... (first 4, last 4)
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}
```

### 12.3. Logger Sanitizer Middleware

```typescript
// Pino redact paths
const logger = pino({
  redact: {
    paths: [
      'password',
      '*.password',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.creditCard',
      '*.secret',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
})
```

---

## 13. KYC Documents Storage

### 13.1. Где хранить

- `/app/uploads/kyc/{userId}/{documentId}/`
- Вне публичной директории (НЕ `/public`)
- Доступ только через backend API

### 13.2. Доступ

- Владелец документа (user) может видеть только "submitted"
- Admin может видеть и скачивать через signed URL
- Signed URL TTL: 5 минут

### 13.3. Retention

- KYC документы хранятся **7 лет** (требование регуляторов)
- Backup обязателен
- Удалять только по запросу пользователя + анонимизация в audit_logs

---

## 14. Admin Security

### 14.1. Отдельный auth flow

- Отдельный secret для admin JWT
- `aud: 'admin'` отличается от user
- Не использовать user credentials для admin

### 14.2. IP Whitelisting (опционально)

```nginx
# /admin.casino.example.com
server {
  listen 443 ssl http2;
  server_name admin.casino.example.com;
  
  allow 1.2.3.4;     # office IP
  allow 5.6.7.8;     # VPN IP
  deny all;
  
  location / {
    proxy_pass http://admin_frontend;
  }
}
```

### 14.3. Все admin действия в audit_logs

```typescript
// После каждого admin action
await this.auditLog.log({
  actorId: adminUser.id,
  actorType: 'admin',
  action: 'USER_BLOCKED',
  entityType: 'user',
  entityId: targetUserId,
  data: { reason: 'ToS violation' },
})
```

### 14.4. Superadmin elevation

- `superadmin` — единственная роль которая может создавать admins / менять settings
- Логировать superadmin действия отдельно (`is_superadmin: true` в audit)

---

## 15. Provider Callbacks — Anti-Cheat

### 15.1. Обязательные проверки

```typescript
async processGameCallback(payload: GameCallbackPayload) {
  // 1. Verify HMAC signature (provider-specific)
  this.verifySignature(payload, signature)
  
  // 2. Check timestamp window (5 minutes)
  if (Math.abs(Date.now() - payload.timestamp) > 5 * 60 * 1000) {
    throw new InvalidTimestampError()
  }
  
  // 3. Check session exists and active
  const session = await this.gameSessionRepo.findById(payload.sessionId)
  if (!session || session.closedAt) throw new InvalidSessionError()
  
  // 4. Check transaction_id uniqueness (provider tx_id)
  const existing = await this.gameTransactionRepo.findByProviderTxId(
    payload.provider, payload.transactionId
  )
  if (existing) {
    // Idempotent replay — return current balance
    return { balance: await this.walletFacade.getBalance(...) }
  }
  
  // 5. Process
  return this.processBet({ ... })
}
```

### 15.2. Лимиты на провайдера

- Max bet per session: 100 000 RUB (configurable per provider)
- Max win multiplier (например 1000x — anti-fraud)
- Time between bets (min 100ms)

---

## 16. Multi-factor Authentication

### 16.1. На MVP — не реализуется

Email + password достаточно для MVP. Если потребуется:

- TOTP через Google Authenticator
- SMS confirmation для withdrawals (дорого, GDPR)
- Email confirmation для withdrawals (хорошо)

### 16.2. Email Confirmation для критичных операций

- Withdrawal > X RUB → confirmation email
- Account password change → confirmation email
- Admin elevation → confirmation email

---

## 17. Privacy & GDPR

### 17.1. Минимальные требования

- **Политика конфиденциальности** на сайте
- **Cookie policy** если есть cookies
- **Right to be forgotten** — endpoint для пользователя удалить аккаунт
- **Data export** — endpoint для выгрузки своих данных

### 17.2. Что НЕ делать на MVP

- Полная GDPR-сертификация
- Cookie consent banner
- Data processing agreements (для providers)

### 17.3. Что делать на MVP

- [ ] Политика конфиденциальности (шаблон)
- [ ] Terms of Service (шаблон)
- [ ] Хранение PII минимально (только то что нужно)
- [ ] Логи не содержат PII где возможно

---

## 18. Vulnerability Scanning

### 18.1. Регулярные проверки

| Инструмент | Когда |
|------------|-------|
| `npm audit` | Каждый PR |
| SNYK / SonarQube | Optional |
| OWASP ZAP | Перед релизом |
| Security headers test | Перед релизом |

### 18.2. CI pipeline

```yaml
- name: Security audit
  run: pnpm audit --audit-level high
  
- name: Check for secrets
  run: |
    if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
      trufflehog --fail --regex --entropy=3.5 .
    fi
```

---

## 19. Incident Response

### 19.1. При обнаружении инцидента

```
1. Isolate — заблокировать compromised компонент
2. Document — собрать timeline
3. Contain — предотвратить дальнейший ущерб
4. Eradicate — устранить root cause
5. Recover — восстановить normal operation
6. Lessons learned — задокументировать
```

### 19.2. Сценарии

| Инцидент | Действия |
|----------|----------|
| Утечка JWT secret | Rotate, force logout all, проверить audit logs |
| DB breach | Reset passwords, force re-auth, notify users |
| Provider account compromise | Rotate API keys, проверить recent transactions |
| Admin credentials leak | Disable admin account, сменить пароль, проверить audit |

### 19.3. Контакты

| Тип | Кого уведомить |
|-----|---------------|
| DB breach | DPO, юристы, пользователи (email) |
| Webhook spoofing detected | Paуза provider integration, contact provider |
| Admin account compromise | Заблокировать все admin sessions, сменить JWT secret |

---

## 20. Code Review Security Checklist

Перед каждым PR:

- [ ] Нет хардкоженных secrets
- [ ] Все inputs валидируются
- [ ] Authorisation проверяется на каждом endpoint
- [ ] Нет SQL injection (используется Prisma)
- [ ] Sensitive data не в logs
- [ ] Owner check у всех user-data endpoints
- [ ] Idempotency на всех финансовых endpoints
- [ ] Optimistic locking на wallet operations
- [ ] Webhook signature проверяется
- [ ] File uploads ограничены

---

> **Главный принцип:** безопасность через **многоуровневую защиту**. Никогда не полагаться на одну проверку — каждая граница имеет свои проверки.
