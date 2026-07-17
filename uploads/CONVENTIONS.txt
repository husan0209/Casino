---
title: Conventions
description: Все code-style и code-organization правила casino-platform
status: living document
last_updated: 2026-06-19
---

# Code Conventions

> **Назначение:** Единые правила кода. Соблюдение критично для предсказуемости и работы AI-агента.

---

## 1. TypeScript

### 1.1. Strict mode

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false
  }
}
```

### 1.2. Целевые версии

```
TypeScript: 5.x
Node.js: 20 LTS
ES Target: ES2022
Module: ESNext  (для native ESM в Next.js),
        CommonJS (для NestJS backend)
```

### 1.3. Запрещено

- ❌ `any` тип (кроме случаев когда буквально any возможен)
- ❌ `@ts-ignore` / `@ts-expect-error` (использовать proper typing)
- ❌ `as unknown as T` (найти правильное API)
- ❌ Implicit `any` через отсутствие типов

Если не получается типизировать — вынести в unknown + runtime check, **не через any**.

---

## 2. Naming

### 2.1. Files & Folders

```
kebab-case         file names     : user.repository.ts
kebab-case         folders        : use-cases/
```

### 2.2. Classes & Types

```
PascalCase         classes        : UserRepository, RegisterUseCase
PascalCase         interfaces     : UserRepository (без префикса IInterface)
PascalCase         types          : UserEntity, MoneyAmount
PascalCase         enums          : UserStatus, KycStatus
```

### 2.3. Methods, Variables, Functions

```
camelCase          methods        : creditWallet(), findById()
camelCase          variables      : userId, walletBalance
camelCase          functions      : calculateGgr(), formatMoney()
```

### 2.4. Constants

```
UPPER_SNAKE_CASE   constants      : MAX_LOGIN_ATTEMPTS, JWT_ACCESS_EXPIRES
SCREAMING_SNAKE    env vars       : JWT_SECRET, DATABASE_URL
```

### 2.5. Private / Internal

```
_prefixWithUnderscore_  reserved   : __internal_helper__()
```

Class private — через TS `private` keyword, не через `_`.

### 2.6. Boolean

Префиксы `is`, `has`, `can`, `should`:

```typescript
isActive       ✅
hasBalance     ✅
canWithdraw    ✅
userActive     ❌ (непонятно boolean или нет)
```

### 2.7. Async

Суффикс `Async` для функций, возвращающих Promise **публично**:

```typescript
async getUserById(): Promise<User>      ✅
async getUserByIdAsync(): Promise<...>   ❌ (async уже означает Promise)
```

---

## 3. Imports

### 3.1. Path aliases

```typescript
// вместо
import { UserRepository } from '../../../domain/repositories/user.repository'

// использовать
import { UserRepository } from '@modules/users/domain/repositories/user.repository'
```

Конфигурация `tsconfig.json`:

```json
{
  "paths": {
    "@/*": ["src/*"],
    "@modules/*": ["src/modules/*"],
    "@packages/*": ["../../packages/*"],
    "@casino/shared-types": ["../../packages/shared-types/src"],
    "@casino/shared-utils": ["../../packages/shared-utils/src"],
    "@casino/database": ["../../packages/database/src"]
  }
}
```

### 3.2. Порядок импортов

В строгом порядке, разделённые пустой строкой:

```typescript
// 1. External packages
import { Injectable } from '@nestjs/common'
import { z } from 'zod'

// 2. Internal packages (shared)
import { UserStatus } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

// 3. Local imports (относительные)
import { UserRepository } from '../repositories/user.repository'
import { UserEntity } from '../entities/user.entity'
```

---

## 4. File Organization

### 4.1. Один файл = одна ответственность

| Файл | Что внутри |
|------|------------|
| `*.entity.ts` | Domain entity |
| `*.repository.ts` | Repository interface |
| `*.repository.impl.ts` или в `infrastructure/repositories` | Repository implementation |
| `*.use-case.ts` | Один use case |
| `*.controller.ts` | HTTP controller |
| `*.service.ts` | Только для БОЛЬШИХ use cases (>50 строк логики) |
| `*.dto.ts` | Request/Response DTOs |
| `*.errors.ts` | Error classes |
| `*.events.ts` | Domain events |
| `*.mapper.ts` | DB row → entity mapper |

### 4.2. Не использовать utils.ts (god-file)

Если файл `utils.ts` начинает превышать 50 строк — разбить:

```
utils/
├── money.ts
├── date.ts
├── crypto.ts
└── pagination.ts
```

### 4.3. Максимальная длина method

Метод не должен превышать **30 строк**. Если превышает — выделить приватные методы.

```typescript
async register(input: RegisterInput): Promise<RegisterResult> {
  await this.validateNotExists(input.email)
  const hashedPassword = await this.hashPassword(input.password)
  const user = await this.createUserEntity(input, hashedPassword)
  await this.userRepository.save(user)
  await this.sendVerificationEmail(user)
  return { user, verificationToken: ... }
}
```

### 4.4. Один use case = один файл

```typescript
// modules/auth/application/use-cases/register-user.use-case.ts
export class RegisterUserUseCase {
  async execute(input: RegisterInput): Promise<RegisterResult> { ... }
}

// modules/auth/application/use-cases/verify-email.use-case.ts
export class VerifyEmailUseCase {
  async execute(input: VerifyEmailInput): Promise<VerifyEmailResult> { ... }
}
```

---

## 5. Деньги — Single Source of Truth

### 5.1. Типы в `shared-types`

```typescript
// packages/shared-types/src/money.ts

export type MoneyAmount = string  // "1500.00"

export type Currency = 'RUB' | 'USDT_TRC20' | 'BTC' | 'TON' | 'TRX' | 'LTC'

export interface Money {
  readonly amount: MoneyAmount
  readonly currency: Currency
}

export const ZERO: Record<Currency, MoneyAmount> = {
  RUB: '0.00',
  USDT_TRC20: '0.00000000',
  BTC: '0.00000000',
  TON: '0.00000000',
  TRX: '0.00000000',
  LTC: '0.00000000',
}
```

### 5.2. Helpers в `shared-utils`

```typescript
// packages/shared-utils/src/money.ts
import { Decimal } from 'decimal.js'

export const money = {
  add(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
    return new Decimal(a).plus(b).toString()
  },
  subtract(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
    return new Decimal(a).minus(b).toString()
  },
  multiply(a: MoneyAmount, factor: string | number): MoneyAmount {
    return new Decimal(a).times(factor).toString()
  },
  divide(a: MoneyAmount, divisor: string | number): MoneyAmount {
    return new Decimal(a).div(divisor).toString()
  },
  isPositive(a: MoneyAmount): boolean {
    return new Decimal(a).gt(0)
  },
  equals(a: MoneyAmount, b: MoneyAmount): boolean {
    return new Decimal(a).eq(b)
  },
  isGreaterOrEqual(a: MoneyAmount, b: MoneyAmount): boolean {
    return new Decimal(a).gte(b)
  },
  toDisplay(a: MoneyAmount, currency: Currency): string {
    const d = new Decimal(a)
    if (currency === 'RUB') return d.toFixed(2)
    return d.toFixed(8)
  },
}
```

### 5.3. Запрещено

```typescript
❌ const balance = 1500.00            // number
❌ const balance: number = 1500       // number типизация
❌ const amount = parseFloat("1500")  // теряет точность
❌ const result = amount * 0.05       // умножение float
❌ balance += 100                     // in-place mutation
```

**Всегда:**

```typescript
✅ const balance: MoneyAmount = "1500.00"
✅ const balance = "1500.00" as MoneyAmount
✅ const amount = new Decimal("1500.00")
✅ const result = money.multiply(amount, "0.05")
✅ const newBalance = money.add(balance, "100")
```

### 5.4. Decimal precision

- **RUB**: точность 2 знака (`1500.00`)
- **Crypto**: точность 8 знаков (`0.12345678`)
- **Хранение в БД**: всегда `DECIMAL(20, 8)` даже для RUB

---

## 6. Error Handling

### 6.1. Domain Errors

Каждый модуль имеет свои ошибки:

```typescript
// modules/wallet/domain/errors/index.ts

export abstract class AppError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number
  
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message)
    this.name = this.constructor.name
  }
}

export class InsufficientFundsError extends AppError {
  readonly code = 'INSUFFICIENT_FUNDS'
  readonly httpStatus = 422
  constructor(public readonly required: MoneyAmount, public readonly available: MoneyAmount) {
    super(
      `Insufficient funds: required ${required}, available ${available}`,
      { required, available }
    )
  }
}

export class WalletNotFoundError extends AppError {
  readonly code = 'WALLET_NOT_FOUND'
  readonly httpStatus = 404
}

export class DuplicateRequestError extends AppError {
  readonly code = 'DUPLICATE_REQUEST'
  readonly httpStatus = 409
  constructor(public readonly idempotencyKey: string) {
    super(`Duplicate request with idempotency key: ${idempotencyKey}`)
  }
}
```

### 6.2. Throw в Domain, Catch в Presentation

```typescript
// application/use-cases/debit-wallet.use-case.ts
if (!money.isGreaterOrEqual(balance, amount)) {
  throw new InsufficientFundsError(amount, balance)  // ✅ throws domain error
}
```

```typescript
// presentation/filters/exception.filter.ts
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof AppError) {
      return errorResponse(exception.code, exception.message, ...)
    }
    
    // Unexpected: log and return generic 500
    logger.error('Unhandled exception', exception)
    return errorResponse('INTERNAL_ERROR', 'Something went wrong')
  }
}
```

### 6.3. Запрещено

- ❌ Try/catch в controller для преобразования ошибок → пусть ExceptionFilter сделает это
- ❌ Throw `Error('something')` → всегда кастомный класс
- ❌ Возвращать `{ error: '...' }` из use case → throw

---

## 7. Logging

### 7.1. Структурированный JSON

```typescript
import { Logger } from 'pino'

this.logger.info({
  module: 'wallet',
  action: 'deposit_completed',
  userId: user.id,
  currency: 'RUB',
  amount: '5000.00',
  paymentRequestId: 'dep_abc123',
}, 'Deposit completed successfully')
```

### 7.2. Обязательные поля

Каждый log имеет:
- `timestamp` (ISO)
- `level` (info, warn, error, debug)
- `service` (имя приложения)
- `requestId`
- `userId` (если есть)
- `module` (auth, wallet, payments, etc.)
- `action` (event name)

### 7.3. Что НЕЛЬЗЯ логировать

- ❌ Пароли (даже хеши)
- ❌ Refresh tokens
- ❌ API keys / secrets
- ❌ Номера карт целиком (маскировать: `**** **** **** 1234`)
- ❌ KYC документы
- ❌ Request body с конфиденциальными полями

### 7.4. Уровни

| Level | Когда |
|-------|-------|
| `error` | Критичные: payment failure, DB error |
| `warn` | Подозрительное: invalid signature, rate limit |
| `info` | Важные события: login, deposit completed |
| `debug` | Подробности для разработки (НЕ в prod) |

---

## 8. Async / Await

### 8.1. Никогда не ignore Promise

```typescript
❌ this.sendEmail(user)              // fire and forget — потеря ошибок
✅ await this.sendEmail(user)
```

Если действительно fire-and-forget — в BullMQ, не в коде.

### 8.2. Promise.all для параллельных операций

```typescript
const [user, wallet] = await Promise.all([
  this.userRepository.findById(userId),
  this.walletRepository.findByUserId(userId),
])
```

### 8.3. Sequential если есть зависимость

```typescript
const user = await this.userRepository.findById(userId)
const wallet = await this.walletRepository.findByUserId(user.id)
```

---

## 9. Comments

### 9.1. Зачем комментировать

- ✅ Зачем этот код существует (не "что" — это видно из кода)
- ✅ Бизнес-правила (например, "KYC limit applies only for unverified users")
- ✅ Gotchas (например, "Race condition: use optimistic locking")
- ✅ Ссылки на ТЗ/тикет

### 9.2. Format

```typescript
// ── Public section ──────────────────────────────────────────
// Public methods
public method1() { ... }

// ── Internal section ────────────────────────────────────────
// Private helpers (lowercase prefix only for non-method functions)
function _helperFunction() { ... }
```

Doc comments только для публичных API:

```typescript
/**
 * Process incoming payment webhook from Rukassa.
 * Validates signature, creates payment request, credits wallet if completed.
 *
 * @throws {InvalidSignatureError} if signature is invalid
 * @throws {DuplicateRequestError} if idempotency key conflict
 */
async processRukassaWebhook(payload: ...
```

---

## 10. Git Conventions

### 10.1. Branch Names

```
feat/    feature/      feat/auth-google-oauth
fix/                   fix/wallet-concurrent-credit
chore/                 chore/eslint-setup
docs/                  docs/api-conventions
refactor/              refactor/wallet-facade
test/                  test/wallet-credit-idempotency
```

### 10.2. Commit Messages (Conventional Commits)

```
feat(auth): add Google OAuth login
fix(wallet): prevent negative balance on concurrent credit
chore(deps): bump prisma to 5.18.0
docs(api): document error codes
refactor(payments): split webhook processing into stages
test(wallet): add idempotency tests for credit
```

Commitlint проверяет формат в CI.

### 10.3. PR описания

Template:

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

## Тестирование
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual E2E test

## Checklist
- [ ] TypeScript compiles
- [ ] Lint passes
- [ ] No new lint warnings
- [ ] Migration applied (if needed)
```

---

## 11. Test Conventions

### 11.1. Структура

```typescript
describe('WalletService.credit', () => {
  let service: WalletService
  let userRepo: MockUserRepository
  let walletRepo: MockWalletRepository

  beforeEach(() => {
    userRepo = new MockUserRepository()
    walletRepo = new MockWalletRepository()
    service = new WalletService(userRepo, walletRepo)
  })

  describe('happy path', () => {
    it('credits balance and creates ledger entry', async () => {
      // arrange
      await walletRepo.seed({ userId, currency: 'RUB', balance: '100.00' })

      // act
      const result = await service.credit({
        userId,
        currency: 'RUB',
        amount: '50.00',
        idempotencyKey: 'dep_1',
      })

      // assert
      expect(result.newBalance).toBe('150.00')
      expect(walletRepo.getBalance(userId, 'RUB')).toBe('150.00')
    })
  })

  describe('error cases', () => {
    it('returns DUPLICATE_REQUEST for repeated idempotency key', async () => {
      // ...
    })
  })
})
```

### 11.2. AAA (Arrange-Act-Assert)

Каждый тест имеет 3 секции через пустые строки.

### 11.3. Имена тестов

```
✅ "credits balance and creates ledger entry"
✅ "returns DUPLICATE_REQUEST for repeated idempotency key"
❌ "test_credit_1"
❌ "credit_works"
```

---

> **Главный принцип:** код должен быть написан так, чтобы **следующий AI-агент мог его продолжить без объяснений**. Стандарты и предсказуемость важнее краткости.
