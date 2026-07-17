---
title: Module Template
description: Пошаговый чеклист создания нового backend модуля (NestJS, 4-layer структура)
audience: AI agents + разработчики
status: living document
last_updated: 2026-06-19
---

# Module Template

> **Назначение:** Этот документ — **пошаговый чеклист** для создания нового модуля. Если AI-агент должен создать модуль, он **ДОЛЖЕН** следовать этим 10 шагам в точности.
>
> **Зачем отдельный шаблон:** [MODULE_BOUNDARIES.md](./MODULE_BOUNDARIES.md) описывает ЧТО делает каждый модуль. [ARCHITECTURE.md](./ARCHITECTURE.md) §5 описывает из каких слоёв состоит модуль. Этот документ — КАК создать модуль с нуля шаг за шагом.

---

## Прежде чем начать

Создавать модуль **можно только** когда:

-   [ ] В TZ (tz-part-*.md) явно описан этот модуль или одобрена его необходимость пользователем
-   [ ] Прочитан [MODULE_BOUNDARIES.md](./MODULE_BOUNDARIES.md) — модуль не дублирует существующий
-   [ ] Прочитан [AI_DEVELOPMENT_RULES.md](./AI_DEVELOPMENT_RULES.md) — особенно правила про деньги, idempotency, ошибки
-   [ ] Прочитан [CONVENTIONS.md](./CONVENTIONS.md) — naming, типы, money helpers
-   [ ] Прочитан [ARCHITECTURE.md](./ARCHITECTURE.md) §5 — 4 слоя и их зависимости
-   [ ] Проверены `packages/shared-types/src/` — какие enum/types уже есть (не дублировать)
-   [ ] Проверены `packages/shared-utils/src/` — какие helpers есть (money, error, etc.)
-   [ ] Проверены `packages/database/prisma/schema/` — какие таблицы уже есть

**Если хотя бы один пункт неясен — спроси пользователя ДО начала работы.**

---

## Шаг 1. Определить имя и границы

| Вопрос | Ответ записать в `module-name/README.md` |
|--------|------------------------------------------|
| Имя модуля | `<kebab-case>` (например `wallet`, `referrals`) |
| Ответственность | Одно предложение: что делает модуль |
| Ключевые use cases | Список (5–15 UC из TZ) |
| Зависит от | Какие модули (через Facade) |
| Используется в | Какие модули будут использовать |

**Пример README модуля** (`modules/wallet/README.md`):

```markdown
# Wallet Module

## Ответственность
Кошельки по валютам, ledger, lock/unlock для операций.

## Ключевые use cases
- UC-WALLET-01: Get balance by currency
- UC-WALLET-02: Get all balances
- UC-WALLET-03: Credit (deposit, win, refund, admin credit)
- UC-WALLET-04: Debit (bet, withdrawal, admin debit)
- UC-WALLET-05: Lock / Unlock
- UC-WALLET-06: Currency conversion (через exchange_rates)

## Зависит от
- users (UserFacade)

## Используется в
- payments, casino, game-sessions, referrals, admin
```

---

## Шаг 2. Создать структуру папок

```
apps/api/src/modules/<module-name>/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── enums/
│   ├── errors/
│   └── repositories/
├── application/
│   ├── use-cases/
│   ├── services/             ← только для БОЛЬШИХ use-cases
│   ├── dto/
│   ├── events/
│   └── validators/
├── infrastructure/
│   ├── repositories/
│   ├── adapters/
│   ├── clients/
│   ├── mappers/
│   └── queue/
├── presentation/
│   ├── controllers/
│   ├── dtos/
│   ├── guards/
│   └── interceptors/
├── facade/
│   └── <module-name>.facade.ts
├── <module-name>.module.ts
├── README.md
└── __tests__/
    ├── <module-name>.service.test.ts
    └── <module-name>.controller.test.ts
```

⚠️ **Facade обязателен** — это единственный способ для других модулей использовать функциональность.

---

## Шаг 3. Добавить Prisma модели

### 3.1. Где

`packages/database/prisma/schema/<area>.prisma` — schema разделена по доменам (users.prisma, wallet.prisma, casino.prisma и т.д.).

### 3.2. Что указать в каждой модели

```prisma
model XxxEntity {
  id        String   @id @default(uuid())
  // ... поля ...
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // обязательные индексы для частых фильтров:
  @@index([userId])
  @@index([status])
  @@index([createdAt])

  // уникальные constraints:
  @@unique([userId, currency])                    // составной unique
  @@unique([idempotencyKey])                      // для ledger_entries
}
```

### 3.3. Денежные поля

```prisma
balance   Decimal @db.Decimal(20, 8)
amount    Decimal @db.Decimal(20, 8)
locked    Decimal @default(0) @db.Decimal(20, 8)
version   Int     @default(0)                      // для optimistic locking
```

### 3.4. Миграция

```bash
pnpm db:migrate --name <module-name>_initial
```

---

## Шаг 4. Domain layer (чистая бизнес-логика)

**Запрещено:** Prisma, NestJS (@Injectable, HttpException), Express, любой I/O.

### 4.1. Entities

Файл: `domain/entities/<entity-name>.entity.ts`

```typescript
export class WalletEntity {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly currency: Currency,
    public readonly balance: MoneyAmount,
    public readonly locked: MoneyAmount,
    public readonly version: number,
  ) {}

  // Domain logic (НЕТ I/O)
  get available(): MoneyAmount {
    return money.subtract(this.balance, this.locked)
  }

  hasFunds(amount: MoneyAmount): boolean {
    return money.isGreaterOrEqual(this.available, amount)
  }
}
```

### 4.2. Value Objects

Для примитивов с валидацией (Email, IpAddress, ReferralCode и т.д.):
`domain/value-objects/<vo-name>.value-object.ts`

### 4.3. Enums

```typescript
// domain/enums/xxx-status.enum.ts
export enum XxxStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}
```

⚠️ Если enum нужен **более чем одному модулю** — вынести в `packages/shared-types/src/enums/`.

### 4.4. Errors

Файл: `domain/errors/<module-name>.errors.ts`

```typescript
import { AppError } from '@casino/shared-utils'

export class XxxNotFoundError extends AppError {
  readonly code = 'XXX_NOT_FOUND'
  readonly httpStatus = 404
  constructor(public readonly id: string) {
    super(`Xxx ${id} not found`)
  }
}

export class XxxAlreadyExistsError extends AppError {
  readonly code = 'XXX_ALREADY_EXISTS'
  readonly httpStatus = 409
}
```

### 4.5. Repository Interface

Файл: `domain/repositories/<xxx>.repository.interface.ts`

```typescript
export abstract class IXxxRepository {
  abstract findById(id: string): Promise<XxxEntity | null>
  abstract save(entity: XxxEntity): Promise<XxxEntity>
  abstract findByUserId(userId: string): Promise<XxxEntity[]>
}
```

⚠️ Это **абстрактный класс**, не interface с TS `interface`. Потому что DI в NestJS работает через классы.

---

## Шаг 5. Application layer (use cases)

**Разрешено:** использовать `domain/` (entities, errors), `infrastructure/` через DI (но только интерфейсы).
**Запрещено:** Express, NestJS Controllers, прямой вызов другого модуля, прямой prisma.

### 5.1. DTOs

Файл: `application/dto/<action-name>.dto.ts`

```typescript
import { Currency, MoneyAmount } from '@casino/shared-types'

export interface CreditWalletInput {
  userId: string
  currency: Currency
  amount: MoneyAmount
  idempotencyKey: string
  type: 'DEPOSIT' | 'WIN' | 'ADMIN_CREDIT' | 'REFERRAL_REWARD'
  referenceType?: string
  referenceId?: string
  metadata?: Record<string, unknown>
}

export interface CreditWalletResult {
  balanceBefore: MoneyAmount
  balanceAfter: MoneyAmount
  ledgerEntryId: string
  duplicate: boolean
}
```

### 5.2. Use Case

Файл: `application/use-cases/<action-name>.use-case.ts`

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@casino/database'
import { IXxxRepository, IYyyRepository } from '../../domain/repositories/...'
import { CreditXxxInput, CreditXxxResult } from '../dto/...'
import { money } from '@casino/shared-utils'
import { eventBus, EventTypes } from '../../../events'
import { OptimisticLockError, DuplicateRequestError } from '@casino/shared-utils'

@Injectable()
export class CreditXxxUseCase {
  constructor(
    private readonly xxxRepo: IXxxRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: CreditXxxInput): Promise<CreditXxxResult> {
    // 1. CHECK IDEMPOTENCY
    const existing = await this.xxxRepo.findByIdempotencyKey(input.idempotencyKey)
    if (existing) {
      return { /* ... */, duplicate: true }
    }

    // 2. TRANSACTION + OPTIMISTIC LOCK + RETRY
    return this.prisma.$transaction(async (tx) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const wallet = await this.xxxRepo.findByUserAndCurrency(input.userId, input.currency, tx)
          if (!wallet) throw new XxxNotFoundError(...)
          if (!wallet.hasFunds(input.amount)) throw new InsufficientFundsError(...)

          const newBalance = money.add(wallet.balance, input.amount)

          const updated = await this.xxxRepo.atomicCredit(
            wallet.id, input.amount, wallet.version, tx,
          )
          if (!updated) throw new OptimisticLockError()

          // ledger entry
          await this.xxxRepo.createLedgerEntry({ /* ... */ }, tx)

          return { balanceBefore: wallet.balance, balanceAfter: newBalance, duplicate: false }
        } catch (err) {
          if (err instanceof OptimisticLockError && attempt < 3) {
            await new Promise(r => setTimeout(r, 50 * attempt * attempt))
            continue
          }
          throw err
        }
      }
      throw new Error('Max retries exceeded on optimistic lock')
    }).then(result => {
      // 3. EMIT EVENT (after tx, не внутри)
      if (!result.duplicate) {
        eventBus.emit(EventTypes.XXX_CREDITED, { /* ... */ })
      }
      return result
    })
  }
}
```

### 5.3. Validators (Zod schemas)

Файл: `application/validators/<dto>.validator.ts`

```typescript
import { z } from 'zod'

export const CreditXxxInputSchema = z.object({
  userId: z.string().uuid(),
  currency: z.nativeEnum(Currency),
  amount: z.string().regex(/^\d+\.?\d*$/, 'Invalid amount format'),
  idempotencyKey: z.string().min(1).max(255),
  // ...
})
```

### 5.4. События модуля

Файл: `application/events/<module-name>.events.ts`

```typescript
import { EventTypes } from '../../../events/events'

// Re-export из центрального events.ts
// Handler регистрируется в модуле:
@Injectable()
export class XxxEventHandler {
  constructor(private readonly yyyFacade: YyyFacade) {}

  @OnEvent(EventTypes.XXX_CREDITED)
  async handle(payload: XxxCreditedPayload) {
    // ...
  }
}
```

---

## Шаг 6. Infrastructure layer (внешний мир)

### 6.1. Repository Implementation

Файл: `infrastructure/repositories/prisma-xxx.repository.ts`

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@casino/database'
import { XxxEntity } from '../../domain/entities/xxx.entity'
import { IXxxRepository } from '../../domain/repositories/xxx.repository.interface'
import { money } from '@casino/shared-utils'

@Injectable()
export class PrismaXxxRepository implements IXxxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<XxxEntity | null> {
    const row = await this.prisma.xxxEntity.findUnique({ where: { id } })
    return row ? this.toEntity(row) : null
  }

  async atomicCredit(
    walletId: string, amount: string, expectedVersion: number, tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await tx.walletAccount.updateMany({
      where: { id: walletId, version: expectedVersion },
      data: {
        balance: { increment: amount },
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })
    return result.count > 0
  }

  private toEntity(row: any): XxxEntity {
    return new XxxEntity(
      row.id, row.userId, row.currency, row.balance, row.locked, row.version,
    )
  }
}
```

### 6.2. Mappers (если entity ≠ schema row)

Отдельный файл `infrastructure/mappers/<xxx>.mapper.ts` если mapping не-trivial.

### 6.3. Adapters (внешние провайдеры)

Файл: `infrastructure/adapters/<provider-name>.adapter.ts`

```typescript
// Пример для платёжного провайдера
@Injectable()
export class XxxPaymentAdapter implements PaymentProvider {
  constructor(private readonly httpClient: HttpClient) {}

  async createDeposit(input: CreateDepositInput): Promise<PaymentRequest> {
    // ...
  }

  async verifyWebhook(payload: string, signature: string): Promise<boolean> {
    // ...
  }
}
```

### 6.4. Queue (если нужны background jobs)

Файл: `infrastructure/queue/<queue-name>.producer.ts`

```typescript
@Injectable()
export class XxxQueueProducer {
  constructor(@InjectQueue('xxx-jobs') private readonly queue: Queue) {}

  async scheduleReminder(input: ScheduleInput): Promise<void> {
    await this.queue.add(
      'xxx-reminder',
      input,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    )
  }
}
```

---

## Шаг 7. Presentation layer (HTTP)

### 7.1. DTOs для request/response (с class-validator)

Файл: `presentation/dtos/<action>.request.dto.ts`

```typescript
import { IsString, IsUUID, IsEnum, IsNotEmpty } from 'class-validator'
import { Currency } from '@casino/shared-types'

export class CreditXxxRequestDto {
  @IsUUID() userId!: string
  @IsEnum(Currency) currency!: Currency
  @IsString() @IsNotEmpty() amount!: string  // НЕ number!
  @IsString() @IsNotEmpty() idempotencyKey!: string
}
```

### 7.2. Controller

Файл: `presentation/controllers/<module-name>.controller.ts`

```typescript
import { Controller, Post, Body, UseGuards, HttpCode } from '@nestjs/common'
import { JwtAuthGuard, CurrentUser, Roles, RolesGuard } from '@casino/auth'
import { CreditXxxUseCase } from '../../application/use-cases/credit-xxx.use-case'
import { CreditXxxRequestDto } from '../dtos/credit-xxx.request.dto'
import { successResponse } from '@casino/shared-types'

@Controller('api/v1/xxx')
@UseGuards(JwtAuthGuard, RolesGuard)
export class XxxController {
  constructor(private readonly creditUseCase: CreditXxxUseCase) {}

  @Post('credit')
  @Roles('admin')
  @HttpCode(200)
  async credit(@Body() body: CreditXxxRequestDto) {
    const result = await this.creditUseCase.execute({
      ...body,
      type: 'ADMIN_CREDIT',
    })
    return successResponse(result)
  }
}
```

### 7.3. Guards (если нужны специфичные)

Файл: `presentation/guards/<guard-name>.guard.ts`

⚠️ Не все guard-ы тут — `JwtAuthGuard` берётся из `@casino/auth`.

---

## Шаг 8. Facade (ОБЯЗАТЕЛЬНО для межмодульного общения)

Файл: `facade/<module-name>.facade.ts`

```typescript
import { Injectable } from '@nestjs/common'
import { CreditXxxUseCase } from '../application/use-cases/credit-xxx.use-case'
import { DebitXxxUseCase } from '../application/use-cases/debit-xxx.use-case'

@Injectable()
export class XxxFacade {
  constructor(
    private readonly creditUseCase: CreditXxxUseCase,
    private readonly debitUseCase: DebitXxxUseCase,
  ) {}

  // Один метод = одна "бизнес-операция" для других модулей
  async creditForDeposit(input: {
    userId: string
    currency: Currency
    amount: MoneyAmount
    paymentRequestId: string
  }): Promise<CreditXxxResult> {
    return this.creditUseCase.execute({
      ...input,
      idempotencyKey: `dep_${input.paymentRequestId}`,
      type: 'DEPOSIT',
      referenceType: 'PaymentRequest',
      referenceId: input.paymentRequestId,
    })
  }

  async debitForBet(input: {
    userId: string
    currency: Currency
    amount: MoneyAmount
    gameRoundId: string
  }): Promise<DebitXxxResult> {
    return this.debitUseCase.execute({
      ...input,
      idempotencyKey: `bet_${input.gameRoundId}`,
      type: 'BET',
    })
  }
}
```

**Правило:** в Facade **НЕТ HTTP/DTO логики** — только композиция use cases с правильным idempotencyKey.

---

## Шаг 9. NestJS Module wiring

Файл: `<module-name>.module.ts`

```typescript
import { Module } from '@nestjs/common'
import { PrismaModule } from '@casino/database'
import { BullModule } from '@nestjs/bullmq'

import { XxxController } from './presentation/controllers/xxx.controller'

import { CreditXxxUseCase } from './application/use-cases/credit-xxx.use-case'
import { DebitXxxUseCase } from './application/use-cases/debit-xxx.use-case'

import { PrismaXxxRepository } from './infrastructure/repositories/prisma-xxx.repository'
import { XxxFacade } from './facade/xxx.facade'

import { IXxxRepository } from './domain/repositories/xxx.repository.interface'

@Module({
  imports: [
    PrismaModule,                                // для prisma
    BullModule.registerQueue({ name: 'xxx-jobs' }),  // если есть queue
  ],
  controllers: [XxxController],
  providers: [
    // Use cases
    CreditXxxUseCase,
    DebitXxxUseCase,
    // Repositories (по интерфейсу)
    { provide: IXxxRepository, useClass: PrismaXxxRepository },
    // Facade (экспортируется)
    XxxFacade,
    // Event handlers (если есть)
    // XxxEventHandler,
  ],
  exports: [XxxFacade, IXxxRepository],  // ⭐ только Facade наружу
})
export class XxxModule {}
```

⚠️ **Наружу экспортируется ТОЛЬКО Facade** (не use cases). Это инвариант модуля.

---

## Шаг 10. Тесты + документация

### 10.1. Unit тесты

`__tests__/<module-name>.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { CreditXxxUseCase } from '../application/use-cases/credit-xxx.use-case'
import { MockXxxRepository } from './mocks/mock-xxx.repository'

describe('CreditXxxUseCase', () => {
  let useCase: CreditXxxUseCase
  let repo: MockXxxRepository

  beforeEach(() => {
    repo = new MockXxxRepository()
    useCase = new CreditXxxUseCase(repo)  // мок prisma тоже
  })

  describe('happy path', () => {
    it('credits balance and creates ledger entry', async () => {
      repo.seedWallet({ userId, currency: 'RUB', balance: '100.00' })

      const result = await useCase.execute({
        userId, currency: 'RUB', amount: '50.00',
        idempotencyKey: 'dep_1', type: 'DEPOSIT',
      })

      expect(result.balanceAfter).toBe('150.00')
      expect(result.duplicate).toBe(false)
    })
  })

  describe('idempotency', () => {
    it('returns duplicate=true for repeated idempotency key', async () => {
      repo.seedWallet({ userId, currency: 'RUB', balance: '100.00' })
      const input = { /* ... */, idempotencyKey: 'dep_1' }

      await useCase.execute(input)
      const second = await useCase.execute(input)

      expect(second.duplicate).toBe(true)
      expect(second.balanceAfter).toBe('150.00')  // не изменился
    })
  })

  describe('error cases', () => {
    it('throws INSUFFICIENT_FUNDS when balance < amount', async () => {
      repo.seedWallet({ userId, currency: 'RUB', balance: '10.00' })
      await expect(useCase.execute({ /* amount: 50 */, idempotencyKey: 'dep_1' })).rejects.toThrow(InsufficientFundsError)
    })
  })
})
```

### 10.2. Обновление документации

После создания модуля:

-   [ ] Добавить модуль в карту в [MODULE_BOUNDARIES.md](./MODULE_BOUNDARIES.md) § 1 и § 15 (dependency graph)
-   [ ] Добавить новые события в `apps/api/src/events/events.ts` (если есть)
-   [ ] Добавить новые типы в `packages/shared-types/` (если типы cross-module)
-   [ ] Добавить новые endpoints в [API_CONVENTIONS.md](./API_CONVENTIONS.md) (если публичные)
-   [ ] Обновить `apps/api/src/modules/<module-name>/README.md` если менялся use case список

### 10.3. Чеклист перед PR

-   [ ] `pnpm typecheck` проходит
-   [ ] `pnpm lint` проходит (нет warnings)
-   [ ] `pnpm test` — все new unit tests проходят
-   [ ] Модуль экспортирует **только Facade** наружу
-   [ ] Не используется `number` для денег (только `string`)
-   [ ] Все financial use cases имеют `idempotencyKey` и проверку дубликата
-   [ ] Все ошибки — кастомные классы с `code` и `httpStatus`
-   [ ] Все controller методы возвращают `successResponse(...)` или throw AppError
-   [ ] Use cases НЕ импортируют Controllers, DTOs, Express, class-validator
-   [ ] Domain layer НЕ импортирует `@nestjs/common`, Prisma, IO

---

## Сводка: где какой файл живёт

```
packages/
  shared-types/src/
    enums/                    ← enum если нужен > 1 модулю
    money.ts                  ← MoneyAmount type
    api-responses.ts          ← ApiResponse, successResponse, errorResponse
  shared-utils/src/
    errors/                   ← AppError abstract class
    money.ts                  ← money helpers (add/sub/mul/div)
  database/prisma/schema/
    <area>.prisma             ← модели модуля

apps/api/src/modules/<module-name>/
  domain/                    ← ТОЛЬКО бизнес (no I/O)
  application/               ← use cases (no HTTP)
  infrastructure/            ← repositories, adapters, queues
  presentation/              ← controllers, DTOs
  facade/                    ← ОДНА точка входа для других модулей
  README.md                  ← описание модуля (+ UC список)
  __tests__/                 ← vitest unit tests

apps/api/src/events/
  events.ts                  ← все EventTypes + EventPayloads
  event-bus.ts               ← глобальный EventBus

docs/
  MODULE_BOUNDARIES.md       ← карта модулей (обновить!)
  MODULE_TEMPLATE.md         ← этот файл
```

---

> **Главный принцип:** все 10 шагов обязательны. Если лень писать Facade — это указывает, что модуль не нужен как отдельный domain, попробуй встроить в существующий модуль. Если лень писать readme модуля — другие разработчики (включая будущего AI) не поймут его ответственность.
