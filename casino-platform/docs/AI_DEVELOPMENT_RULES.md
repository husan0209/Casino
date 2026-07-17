---
title: AI Development Rules
description: Правила для AI-агента, разрабатывающего casino-platform
status: living document
audience: AI agents (Claude, GPT-5, etc.)
last_updated: 2026-06-19
criticality: MAX
---

# AI Development Rules

> **Назначение:** Этот документ — **первое, что должен прочитать AI-агент** при работе с casino-platform. Любое нарушение этих правил = потенциальная потеря денег, секретов или доверия пользователей.

---

## 0. Обязательный bootstrap при старте сессии

AI-агент при начале работы **ДОЛЖЕН** прочитать в указанном порядке:

```
1. docs/AI_DEVELOPMENT_RULES.md           ← вы здесь
2. README.md                              ← high-level overview
3. docs/ARCHITECTURE.md                   ← архитектурные решения
4. docs/STACK.md                          ← технологический стек
5. docs/CONVENTIONS.md                    ← coding conventions
6. docs/API_CONVENTIONS.md                ← API standards
7. docs/MODULE_BOUNDARIES.md              ← границы между модулями
8. docs/SECURITY_BASELINE.md              ← безопасность
9. docs/PAYMENT_OVERVIEW.md               ← платежи (если работаем с payments)
10. docs/PROVIDER_INTEGRATION_STRATEGY.md ← провайдеры (если работаем с casino)
11. packages/database/prisma/schema.prisma ← актуальная схема БД
12. Соответствующая часть ТЗ              ← tz-part-N-*.md
```

**Не приступать к коду без чтения всех релевантных файлов.**

---

## 1. ДЕНЬГИ — КРИТИЧНОЕ ПРАВИЛО

### 1.1. Правило

**НИКОГДА** не использовать `number` / `float` для денег.

### 1.2. Где

| Слой | Тип |
|------|-----|
| База данных | `DECIMAL(20, 8)` |
| Backend код | `string` + `decimal.js` / `big.js` |
| API request/response | `string` (например `"1500.00"`) |
| Frontend state | `string` (BigInt для отображения) |

### 1.3. Запрещено

```typescript
// ❌ ЗАПРЕЩЕНО — потеря точности
const balance: number = 1500.00
const amount = parseFloat("1500.00")
const newBalance = balance + amount

// ❌ ЗАПРЕЩЕНО — float умножение
const reward = ggr * 0.05

// ❌ ЗАПРЕЩЕНО — number в API response
{ "amount": 100.00 }
```

### 1.4. Обязательно

```typescript
// ✅ ПРАВИЛЬНО
const balance: MoneyAmount = "1500.00"  // тип string
import { Decimal } from 'decimal.js'

const newBalance = new Decimal(balance).plus(amount).toString()

// ✅ ПРАВИЛЬНО — API
{ "amount": "1500.00", "currency": "RUB" }

// ✅ ПРАВИЛЬНО — в БД
@Column({ type: 'decimal', precision: 20, scale: 8 })
balance: string

// ✅ ПРАВИЛЬНО — в use case
import { money } from '@casino/shared-utils'
const result = money.multiply(ggr, env.REFERRAL_REWARD_RATE)
```

### 1.5. Где правило хранится

- `packages/shared-types/src/money.ts` — типы `MoneyAmount`, `Currency`
- `packages/shared-utils/src/money.ts` — helpers (`money.add`, `money.subtract`, ...)

**Всегда импортировать из центрального места**, не писать свои helpers.

---

## 2. IDEMPOTENCY — КРИТИЧНОЕ ПРАВИЛО

### 2.1. Правило

**КАЖДАЯ** финансовая операция **ДОЛЖНА** иметь `idempotency_key` и проверять дубликаты **ДО** выполнения.

### 2.2. Зачем

Webhooks от payment-провайдеров могут приходить **2+ раз** с одинаковым payload. Без идемпотентности — повторный credit/debit.

### 2.3. Формат ключей

| Операция | Формат |
|----------|--------|
| Deposit | `dep_{payment_request.id}` |
| Withdrawal | `wd_{withdrawal_request.id}` |
| Bet | `bet_{provider_transaction_id}` |
| Win | `win_{provider_round_id}_{index}` |
| Rollback | `rb_{original_transaction_id}` |
| Referral reward | `ref_{referrer_id}_{referred_id}_{YYYY-MM-DD}` |
| Admin credit | `adm_credit_{actor_id}_{timestamp}` |
| Admin debit | `adm_debit_{actor_id}_{timestamp}` |
| KYC status change | `kyc_{kyc_id}_{old_status}_to_{new_status}` |

### 2.4. Реализация

```typescript
// modules/wallet/application/use-cases/credit-wallet.use-case.ts

async execute(input: CreditInput): Promise<CreditResult> {
  // 1. Проверить дубликат
  const existing = await this.ledgerRepo.findByIdempotencyKey(input.idempotencyKey)
  if (existing) {
    return {
      balanceBefore: existing.balanceBefore,
      balanceAfter: existing.balanceAfter,
      ledgerEntryId: existing.id,
      duplicate: true,  // ⚠️ сигнал что это повтор
    }
  }

  // 2. Выполнить в transaction с optimistic locking
  return this.prisma.$transaction(async (tx) => {
    // Optimistic lock retry loop
    let attempts = 0
    while (attempts < 3) {
      try {
        const wallet = await this.walletRepo.findByUserAndCurrency(tx, input.userId, input.currency)
        
        const newBalance = money.add(wallet.balance, input.amount)
        
        const updated = await tx.walletAccount.updateMany({
          where: {
            userId: input.userId,
            currency: input.currency,
            version: wallet.version,  // ⚠️ optimistic lock
          },
          data: {
            balance: newBalance,
            version: { increment: 1 },
          },
        })
        
        if (updated.count === 0) {
          throw new OptimisticLockError()  // retry
        }
        
        const ledgerEntry = await tx.ledgerEntry.create({
          data: {
            userId: input.userId,
            currency: input.currency,
            type: input.type,
            amount: input.amount,
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            idempotencyKey: input.idempotencyKey,  // UNIQUE constraint
            referenceType: input.referenceType,
            referenceId: input.referenceId,
          },
        })
        
        return {
          balanceBefore: wallet.balance,
          balanceAfter: newBalance,
          ledgerEntryId: ledgerEntry.id,
          duplicate: false,
        }
      } catch (err) {
        if (err instanceof OptimisticLockError && attempts < 2) {
          attempts++
          await sleep(50 * attempts * attempts)  // exponential backoff
          continue
        }
        throw err
      }
    }
    throw new MaxRetriesExceededError()
  })
}
```

---

## 3. СТРУКТУРА МОДУЛЯ — обязательная

### 3.1. Правило

Каждый модуль имеет **предсказуемую 4-слойную структуру**:

```
module/
├── domain/                          ← чистая бизнес-логика
│   ├── entities/                    ← XxxEntity
│   ├── value-objects/               ← Money, Email
│   ├── enums/                       ← XxxStatus
│   ├── errors/                      ← XxxError
│   └── repositories/                ← IXxxRepository
│
├── application/                     ← use cases / orchestration
│   ├── use-cases/                   ← XxxUseCase
│   ├── services/                    ← только для БОЛЬШИХ use cases
│   ├── dto/                         ← input/output контракты
│   ├── events/                      ← DomainEvent definitions
│   └── validators/                  ← Zod schemas
│
├── infrastructure/                  ← внешний мир
│   ├── repositories/                ← PrismaXxxRepository
│   ├── adapters/                    ← ExternalProvider adapters
│   ├── clients/                     ← HttpClient, RedisClient
│   ├── mappers/                     ← DB row → entity
│   └── queue/                       ← BullMQ producers/consumers
│
├── presentation/                    ← HTTP
│   ├── controllers/                 ← XxxController
│   ├── dtos/                        ← Request/Response DTO
│   ├── guards/                      ← XxxGuard
│   └── interceptors/                ← XxxInterceptor
│
└── xxx.module.ts                    ← NestJS module wiring
```

### 3.2. Правила зависимостей

| Слой | Может импортировать | Не может импортировать |
|------|---------------------|------------------------|
| `presentation` | `application` (DTOs), shared types | `domain` напрямую, `infrastructure` |
| `application` | `domain`, `infrastructure` (только через DI/интерфейсы) | `presentation` |
| `infrastructure` | `domain` (entities для mapper) | `application`, `presentation` |
| `domain` | НИЧЕГО | всё остальное |

### 3.3. Бизнес-логика — ТОЛЬКО в application

❌ Запрещено писать business logic в `controller` или `repository`.

```typescript
// ❌ НЕПРАВИЛЬНО — логика в controller
@Post('register')
async register(@Body() body: RegisterDto) {
  const existing = await this.prisma.user.findUnique({ where: { email: body.email } })
  if (existing) throw new ConflictException()
  
  const hashed = await argon2id(body.password)
  const user = await this.prisma.user.create({
    data: { email: body.email, passwordHash: hashed },
  })
  
  await this.emailService.sendVerification(user.email, 'token')
  return { success: true, data: user }
}

// ✅ ПРАВИЛЬНО — логика в use case
@Post('register')
async register(@Body() body: RegisterDto) {
  const result = await this.registerUseCase.execute({
    email: body.email,
    password: body.password,
  })
  return { success: true, data: result }
}

// В RegisterUseCase:
async execute(input: RegisterInput): Promise<RegisterResult> {
  await this.validateNotExists(input.email)
  const hashedPassword = await this.passwordHasher.hash(input.password)
  const user = await this.userRepository.save(UserEntity.create({ email: input.email, hashedPassword }))
  await this.verificationTokenService.create(user.id)
  await this.notificationService.sendVerificationEmail(user)
  return { user, verificationTokenSent: true }
}
```

---

## 4. ОТВЕТЫ API — обязательный формат

### 4.1. Правило

**ВСЕГДА** использовать единый wrapper для ответов.

### 4.2. Утилиты

В `packages/shared-utils/src/api-response.ts`:

```typescript
export function successResponse<T>(data: T, meta?: Record<string, unknown>) {
  return { success: true as const, data, ...(meta && { meta }) }
}

export function successPaginatedResponse<T>(data: T[], meta: PaginationMeta) {
  return { success: true as const, data, meta }
}

export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string,
) {
  return {
    success: false as const,
    error: { code, message, details, requestId },
  }
}
```

### 4.3. Использование в Controller

```typescript
@Controller('auth')
@UseInterceptors(ResponseFormatInterceptor)
export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
  ) {}

  @Post('register')
  async register(@Body() body: RegisterDto) {
    // Controller ВОЗВРАЩАЕТ domain data, interceptor оборачивает в {success, data}
    return this.registerUseCase.execute({
      email: body.email,
      password: body.password,
    })
  }
}

// ResponseFormatInterceptor автоматически:
// return { success: true, data: resultFromController }
```

### 4.4. Запрещено

- ❌ Возвращать объект напрямую (обход interceptor)
- ❌ Делать `res.json({error: '...'})` в controller
- ❌ Возвращать разные форматы в разных endpoints

---

## 5. ОШИБКИ — кастомные классы

### 5.1. Правило

**ВСЕГДА** создавать кастомные ошибки, расширяющие `AppError`.

### 5.2. Базовый класс

```typescript
// packages/shared-utils/src/errors/app-error.ts

export abstract class AppError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number
  
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = this.constructor.name
  }
  
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
    }
  }
}
```

### 5.3. Примеры

```typescript
// modules/wallet/domain/errors/index.ts

export class InsufficientFundsError extends AppError {
  readonly code = 'INSUFFICIENT_FUNDS'
  readonly httpStatus = 422
  
  constructor(
    public readonly required: MoneyAmount,
    public readonly available: MoneyAmount,
  ) {
    super('Insufficient funds', { required, available })
  }
}

export class WalletNotFoundError extends AppError {
  readonly code = 'WALLET_NOT_FOUND'
  readonly httpStatus = 404
  
  constructor(public readonly userId: string, public readonly currency: Currency) {
    super(`Wallet not found for user ${userId} in ${currency}`)
  }
}

export class DuplicateRequestError extends AppError {
  readonly code = 'DUPLICATE_REQUEST'
  readonly httpStatus = 409
  
  constructor(public readonly idempotencyKey: string) {
    super(`Duplicate request: ${idempotencyKey}`)
  }
}

export class KycRequiredError extends AppError {
  readonly code = 'KYC_REQUIRED'
  readonly httpStatus = 422
  
  constructor(message: string = 'KYC verification required') {
    super(message)
  }
}

export class OptimisticLockError extends AppError {
  readonly code = 'OPTIMISTIC_LOCK_CONFLICT'
  readonly httpStatus = 500  // silent retry, then 500
  
  constructor() {
    super('Optimistic lock conflict, retry needed')
  }
}
```

### 5.4. Использование в Use Case

```typescript
// ❌ НЕПРАВИЛЬНО
throw new Error('Not enough funds')
throw new BadRequestException('Not enough funds')

// ✅ ПРАВИЛЬНО
if (!money.isGreaterOrEqual(balance, amount)) {
  throw new InsufficientFundsError(amount, balance)
}
```

### 5.5. Global Exception Filter

```typescript
// presentation/filters/global-exception.filter.ts

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    
    if (exception instanceof AppError) {
      // Domain error — convert to API response
      response.status(exception.httpStatus).json(
        errorResponse(
          exception.code,
          exception.message,
          exception.context,
          request.id,
        )
      )
      return
    }
    
    if (exception instanceof HttpException) {
      // NestJS HTTP exception (ValidationPipe, etc)
      const status = exception.getStatus()
      response.status(status).json(
        errorResponse(
          this.codeFromStatus(status),
          exception.message,
        )
      )
      return
    }
    
    // Unknown — log and return generic 500
    logger.error('Unhandled exception', { err: exception, requestId: request.id })
    response.status(500).json(
      errorResponse('INTERNAL_ERROR', 'Something went wrong', undefined, request.id)
    )
  }
}
```

---

## 6. БЕЗОПАСНОСТЬ

### 6.1. Правило

- **НИКОГДА** не логировать: пароли, токены, API keys, полные номера карт, документы
- **ВСЕГДА** валидировать input через Zod (или class-validator)
- **ВСЕГДА** проверять права в **Guard**, не в Service
- **ВСЕГДА** проверять owner для user-specific endpoints

### 6.2. IDOR prevention

```typescript
// ❌ НЕПРАВИЛЬНО — нет owner check
@Get(':id')
async getTransaction(@Param('id') id: string) {
  return this.transactionRepo.findById(id)
}

// ✅ ПРАВИЛЬНО — проверяем owner
@Get(':id')
async getTransaction(
  @Param('id') id: string,
  @CurrentUser() user: User,
) {
  const tx = await this.transactionRepo.findById(id)
  if (tx.userId !== user.id && user.role !== 'admin') {
    throw new ForbiddenError('Cannot access this resource')
  }
  return tx
}
```

### 6.3. Authorization в Guard, не в Service

```typescript
// ✅ AuthGuard проверяет JWT
// ✅ RolesGuard проверяет role
// ✅ KycGuard проверяет KYC status
// Service НЕ ДОЛЖЕН проверять "if (user.role === 'admin')"
```

### 6.4. Log sanitizer

```typescript
// Используем Pino redact
const logger = pino({
  redact: {
    paths: [
      'password',
      '*.password',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.creditCard',
      '*.cardNumber',
      '*.secret',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
})
```

---

## 7. ТРАНЗАКЦИИ БД

### 7.1. Правило

- Все финансовые операции — внутри `prisma.$transaction()`
- При `OptimisticLockError` — retry до 3 раз с exponential backoff
- Никогда не делать `prisma.x.update()` напрямую в use case

### 7.2. Паттерн

```typescript
async execute(input: CreditInput): Promise<CreditResult> {
  let lastError: Error | undefined
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.walletAccount.findUnique({
          where: { userId_currency: { userId: input.userId, currency: input.currency } },
        })
        
        if (!wallet) throw new WalletNotFoundError(input.userId, input.currency)
        
        const newBalance = money.add(wallet.balance, input.amount)
        
        const updated = await tx.walletAccount.updateMany({
          where: {
            userId: input.userId,
            currency: input.currency,
            version: wallet.version,
          },
          data: {
            balance: newBalance,
            version: { increment: 1 },
          },
        })
        
        if (updated.count === 0) throw new OptimisticLockError()
        
        await tx.ledgerEntry.create({
          data: {
            userId: input.userId,
            currency: input.currency,
            type: input.type,
            amount: input.amount,
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            idempotencyKey: input.idempotencyKey,
          },
        })
        
        return { balanceBefore: wallet.balance, balanceAfter: newBalance }
      }, {
        isolationLevel: 'Serializable',  // ⚠️ strongest isolation
      })
    } catch (err) {
      if (err instanceof OptimisticLockError && attempt < 3) {
        lastError = err
        await sleep(50 * attempt * attempt)
        continue
      }
      throw err
    }
  }
  
  throw lastError ?? new MaxRetriesExceededError()
}
```

### 7.3. NON-blocking mutations

НЕ делать долгие операции внутри transaction:

```typescript
// ❌ НЕПРАВИЛЬНО — отправка email внутри transaction
await prisma.$transaction(async (tx) => {
  await tx.user.update(...)
  await this.emailService.sendWelcomeEmail(user)  // ❌ slow I/O inside tx
})

// ✅ ПРАВИЛЬНО — быстрый transaction, потом side effects
await prisma.$transaction(async (tx) => {
  await tx.user.update(...)
})
await this.emailService.sendWelcomeEmail(user)  // ✅ outside tx

// ✅ ИЛИ — BullMQ queue
await prisma.$transaction(async (tx) => {
  await tx.user.update(...)
  await tx.emailJob.create({ data: { userId: user.id, template: 'welcome' } })
})
```

---

## 8. WEBHOOK ОБРАБОТКА — обязательная

### 8.1. Правило

- **ВСЕГДА** сохранять raw callback в БД **ДО** обработки
- **ВСЕГДА** возвращать 200 OK провайдеру (даже при ошибке)
- **НИКОГДА** не зачислять средства без валидной подписи
- **НИКОГДА** не дублировать обработку (idempotency)

### 8.2. Алгоритм

```
1. Receive webhook → Save raw body + headers to payment_callbacks
2. Verify signature (HMAC) → if invalid, log warning and return 400 OR 200 OK (decide based on risk)
3. Parse event
4. Check duplicate by external transaction_id
   - If duplicate → return 200 OK with current balance
5. Process event (wallet credit/debit, ledger, notification)
6. Mark payment_callbacks.processed = true
7. Return 200 OK
```

### 8.3. Запрещено

- ❌ Skip signature verification «для скорости»
- ❌ Update without saving raw callback first
- ❌ Throw exception in webhook handler (всегда 200 OK)
- ❌ Двойная обработка одного transaction

---

## 9. ПЕРЕД СОЗДАНИЕМ НОВОГО МОДУЛЯ

### 9.1. Правило

Прежде чем создавать новый модуль / use case / endpoint:

### 9.2. Чеклист агента

```markdown
1. [ ] Прочитать docs/MODULE_BOUNDARIES.md
2. [ ] Прочитать docs/CONVENTIONS.md
3. [ ] Прочитать docs/AI_DEVELOPMENT_RULES.md (этот файл)
4. [ ] Проверить packages/shared-types/ на существующие типы
5. [ ] Проверить packages/shared-utils/ на существующие helpers
6. [ ] Проверить актуальную Prisma schema (packages/database/prisma/schema.prisma)
7. [ ] Проверить events/events.ts на существующие domain events
8. [ ] Проверить релевантную TZ часть
9. [ ] Использовать существующие Facades других модулей (НЕ прямые prisma вызовы)
10. [ ] Создать unit тесты
11. [ ] Запустить pnpm typecheck, pnpm lint, pnpm test
12. [ ] Сделать code review через code-reviewer agent (если доступен)
```

### 9.3. Anti-patterns

- ❌ Создать новый тип если уже есть в shared-types
- ❌ Скопировать helper из другого модуля вместо выноса в shared-utils
- ❌ Использовать prisma напрямую вместо Facade
- ❌ Создать controller до use case
- ❌ Смешать HTTP и business logic

---

## 10. ТЕСТЫ

### 10.1. Правило

- **КАЖДЫЙ** Service/Use Case **ДОЛЖЕН** иметь unit тесты
- Mock repository в service tests, **НЕ реальную БД**
- Integration tests — отдельная тестовая БД
- **ОБЯЗАТЕЛЬНО**: тесты для денежных операций, идемпотентности, race conditions

### 10.2. Структура теста

```typescript
describe('WalletService.credit', () => {
  let service: CreditWalletUseCase
  let walletRepo: MockWalletRepository
  let ledgerRepo: MockLedgerRepository
  
  beforeEach(() => {
    walletRepo = new MockWalletRepository()
    ledgerRepo = new MockLedgerRepository()
    service = new CreditWalletUseCase(walletRepo, ledgerRepo)
  })
  
  it('credits balance and creates ledger entry', async () => {
    await walletRepo.seed({ userId, currency: 'RUB', balance: '100.00' })
    
    const result = await service.execute({
      userId,
      currency: 'RUB',
      amount: '50.00',
      type: 'DEPOSIT',
      idempotencyKey: 'dep_1',
    })
    
    expect(result.balanceAfter).toBe('150.00')
    expect(await walletRepo.getBalance(userId, 'RUB')).toBe('150.00')
    expect(await ledgerRepo.count()).toBe(1)
  })
  
  it('returns duplicate result for repeated idempotency key', async () => {
    await walletRepo.seed({ userId, currency: 'RUB', balance: '100.00' })
    
    // First call
    await service.execute({ userId, currency: 'RUB', amount: '50.00', type: 'DEPOSIT', idempotencyKey: 'dep_1' })
    
    // Second call with same key
    const result = await service.execute({ userId, currency: 'RUB', amount: '50.00', type: 'DEPOSIT', idempotencyKey: 'dep_1' })
    
    expect(result.duplicate).toBe(true)
    expect(await walletRepo.getBalance(userId, 'RUB')).toBe('150.00')  // не изменился
  })
  
  it('throws INSUFFICIENT_FUNDS when balance < amount', async () => {
    await walletRepo.seed({ userId, currency: 'RUB', balance: '10.00' })
    
    await expect(
      service.execute({ userId, currency: 'RUB', amount: '50.00', type: 'DEPOSIT', idempotencyKey: 'dep_1' })
    ).rejects.toThrow(InsufficientFundsError)
  })
})
```

### 10.3. Critical scenarios to test

| Module | Critical tests |
|--------|---------------|
| wallet | credit, debit, lock, unlock, optimistic lock retry |
| payments | webhook idempotency, signature verify, KYC limit |
| auth | register, login, refresh rotation, OAuth |
| casino | bet idempotency, win credit, rollback |
| referrals | daily cron GGR calculation |

---

## 11. GIT COMMIT — обязательный формат

### 11.1. Conventional Commits

```
feat(scope): add Google OAuth login
fix(wallet): prevent concurrent credit race
chore(deps): bump prisma to 5.18.0
docs(api): document error codes
refactor(payments): split webhook processing
test(wallet): add idempotency tests
```

### 11.2. Branch names

```
feat/    feat/auth-google-oauth
fix/     fix/wallet-concurrent-credit
chore/   chore/eslint-setup
docs/    docs/api-conventions
refactor/ refactor/wallet-facade
test/    test/wallet-credit-idempotency
```

### 11.3. PR description template

```markdown
## Что делает
[краткое описание]

## Связанные задачи
Closes #123

## Тип изменений
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Docs
- [ ] Refactor

## Тестирование
- [ ] Unit tests pass
- [ ] Integration tests pass (if applicable)
- [ ] Manual E2E test (if applicable)

## Чеклист
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Все новые endpoints документированы
- [ ] Все secrets в .env (не hardcoded)
- [ ] Нет чувствительных данных в коде
```

---

## 12. КРИТИЧЕСКИЕ ЗАПРЕТЫ — список для самопроверки

Прежде чем закоммитить — спросить себя:

- [ ] **Нет** хардкоженных secrets? (API keys, пароли, JWT secret)
- [ ] **Нет** `number` / `float` для денег?
- [ ] **Нет** direct prisma вызовов других модулей?
- [ ] **Есть** idempotency_key для всех финансовых операций?
- [ ] **Есть** webhook signature verification?
- [ ] **Все** sensitive данные НЕ логируются?
- [ ] **Все** endpoints с owner check (кроме admin)?
- [ ] **Все** ошибки — кастомные классы (не raw Error)?
- [ ] **Все** ответы API через successResponse/errorResponse wrapper?
- [ ] **Все** controllers ничего не знают о business logic?
- [ ] **Все** use cases в application/use-cases/?
- [ ] **Все** новые коды ошибок в стандартный список (docs/API_CONVENTIONS.md)?
- [ ] **Все** financial ops в prisma.$transaction()?

---

## 13. КОГДА СПРОСИТЬ ПОЛЬЗОВАТЕЛЯ

Если в процессе работы агент встречает:

- **Architectural decision**, который не описан в TZ
- **Trade-off между двумя valid подходами**
- **Новый тип данных не описан в схеме**
- **Поведение, которое не покрыто тестами реальности** (например, edge case в платежах)

→ **ОСТАНОВИТЬСЯ** и спросить пользователя через `ask_user` tool.

Не пытаться угадывать критичные бизнес-решения.

---

> **Главный принцип:** этот документ — компас. Если код нарушает любое из этих правил, есть 99% вероятность что он неправильный. Перечитать правило, переписать код, протестировать.
