---
title: Payment Overview
description: Обзор payment-провайдеров, идемпотентности и webhook обработки
status: living document
last_updated: 2026-06-19
---

# Payment Overview

> **Назначение:** Описать все интеграции с payment-провайдерами, принципы работы, обработку ошибок и идемпотентность.

---

## 1. Поддерживаемые провайдеры

### 1.1. Обзор

| Provider | Тип | Валюты | Markets | Регион |
|----------|-----|--------|---------|--------|
| **Rukassa** | Фиат | RUB | CIS | Russia |
| **NOWPayments** | Крипто | USDT/BTC/TON/TRX/LTC | Global | Worldwide |

### 1.2. Архитектура интеграции

```
Payments Module
├── application/
│   ├── use-cases/
│   │   ├── create-deposit.use-case.ts
│   │   ├── create-withdrawal.use-case.ts
│   │   └── process-webhook.use-case.ts
│   └── facade/
│       └── payments.facade.ts
├── infrastructure/
│   ├── adapters/
│   │   ├── payment-provider.interface.ts      ← единый интерфейс
│   │   ├── rukassa.adapter.ts
│   │   ├── nowpayments.adapter.ts
│   │   └── manual.adapter.ts
│   └── clients/
│       ├── rukassa-http.client.ts
│       └── nowpayments-http.client.ts
└── presentation/
    ├── controllers/
    │   ├── deposit.controller.ts
    │   └── withdrawal.controller.ts
```

---

## 2. Единый интерфейс провайдера

Все payment-провайдеры реализуют **единый интерфейс**:

```typescript
// payments/infrastructure/adapters/payment-provider.interface.ts

export interface PaymentProvider {
  readonly name: 'rukassa' | 'nowpayments' | 'manual'
  
  // ── Deposit ─────────────────────────────────────
  createDeposit(input: CreateDepositInput): Promise<CreateDepositResult>
  checkDepositStatus(externalId: string): Promise<ProviderStatus>
  
  // ── Withdrawal ──────────────────────────────────
  createWithdrawal(input: CreateWithdrawalInput): Promise<CreateWithdrawalResult>
  checkWithdrawalStatus(externalId: string): Promise<ProviderStatus>
  
  // ── Webhook ─────────────────────────────────────
  verifyWebhookSignature(rawBody: string, signature: string): boolean
  
  parseWebhook(rawBody: string): ProviderWebhookEvent
}

export interface CreateDepositInput {
  orderId: string            // payment_request.id
  amount: MoneyAmount
  currency: Currency
  userId: string
  description?: string
  successUrl: string
  failUrl: string
  metadata?: Record<string, string>
}

export interface CreateDepositResult {
  externalId: string         // provider's invoice ID
  paymentUrl?: string        // для redirect (фиат) или details (crypto)
  cryptoAddress?: string     // для crypto-провайдеров
  cryptoAmount?: MoneyAmount // для crypto-провайдеров
  expiresAt?: Date           // для crypto-invoice (обычно 30 минут)
}

export interface ProviderStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired'
  amount?: MoneyAmount
  externalId: string
  raw?: unknown              // raw provider response (для debug)
}

export interface ProviderWebhookEvent {
  type: 'deposit.success' | 'deposit.failed' | 'withdrawal.success' | 'withdrawal.failed'
  externalId: string
  orderId?: string           // our payment_request.id
  amount?: MoneyAmount
  status: ProviderStatus['status']
  raw: unknown               // full payload (for audit)
}
```

### 2.1. Преимущества

- Один `process-webhook.use-case.ts` работает со всеми провайдерами
- Новый провайдер = новая адаптер-имплементация + регистрация в DI
- Тестирование через mock любого интерфейса

---

## 3. Поток депозита (Deposit Flow)

```
┌────────┐                       ┌─────────┐                ┌───────────┐
│  User  │                       │ Backend │                │ Provider  │
└───┬────┘                       └────┬────┘                └─────┬─────┘
    │ 1. POST /payments/deposit       │                          │
    │ { amount, currency, method }    │                          │
    ├────────────────────────────────►│                          │
    │                                  │ 2. Validate KYC limit    │
    │                                  │    CheckMethodSupport   │
    │                                  │    CheckCurrencySupport │
    │                                  │                          │
    │                                  │ 3. Create payment_request│
    │                                  │    status=PENDING         │
    │                                  │                          │
    │                                  │ 4. provider.createDeposit│
    │                                  ├─────────────────────────►│
    │                                  │                          │
    │                                  │◄─────────────────────────┤
    │                                  │ { externalId, paymentUrl │
    │                                  │   cryptoAddress, ... }   │
    │                                  │                          │
    │                                  │ 5. Update payment_request │
    │                                  │    status=PROCESSING     │
    │                                  │    externalId=...         │
    │ 6. Response: { paymentUrl, ... } │                          │
    │◄─────────────────────────────────┤                          │
    │                                  │                          │
    │ 7. User pays via paymentUrl       │                          │
    ├─────────────────────────────────────────────────────────────────►
    │                                  │                          │
    │                                  │ 8. Webhook callback      │
    │                                  │◄─────────────────────────┤
    │                                  │                          │
    │                                  │ 9. Verify signature      │
    │                                  │ 10. Save to payment_callbacks
    │                                  │ 11. Check duplicate      │
    │                                  │ 12. wallet.credit()      │
    │                                  │ 13. Update status        │
    │                                  │ 14. Send notification    │
    │                                  │ 15. Return 200 OK        │
    │                                  ├─────────────────────────►│
```

### 3.1. Депозит для фиата (Rukassa)

Метод: redirect на payment page.

```
Frontend → Backend → Rukassa API → Redirect URL → Payment page
                                         ↓
                  User pays → Rukassa sends webhook → Backend
                                       ↓
                  Backend credits wallet → Notification → Frontend polling
```

### 3.2. Депозит для крипто (NOWPayments)

Метод: показать адрес + сумму + QR.

```
Frontend → Backend → NOWPayments API → cryptoAddress + cryptoAmount
                                              ↓
                  User sends crypto → Blockchain → NOWPayments detects
                                              ↓
                  NOWPayments sends IPN webhook → Backend
                                              ↓
                  Backend credits wallet (по actually_paid) → ...
```

---

## 4. Поток вывода (Withdrawal Flow)

```
┌────────┐                     ┌─────────┐                ┌───────────┐
│  User  │                     │ Backend │                │ Provider  │
└───┬────┘                     └────┬────┘                └─────┬─────┘
    │ 1. POST /payments/withdraw     │                          │
    │ { amount, currency,           │                          │
    │   destination }                │                          │
    ├────────────────────────────────►│                          │
    │                                │ 2. Check KYC approved    │
    │                                │ 3. Check balance         │
    │                                │ 4. Check withdrawal limit│
    │                                │                          │
    │                                │ 5. wallet.lock()         │
    │                                │    available -= amount   │
    │                                │                          │
    │                                │ 6. Create withdrawal_req │
    │                                │    status=PENDING         │
    │ 7. Response: { reqId, status } │                          │
    │◄───────────────────────────────┤                          │
    │                                │                          │
    │                                │ 8. (admin manually       │
    │                                │     approves in admin)   │
    │                                │                          │
    │                                │ 9. provider.createWithdrawal│
    │                                ├─────────────────────────►│
    │                                │                          │
    │                                │◄─────────────────────────┤
    │                                │ { externalId }           │
    │                                │                          │
    │                                │ 10. wallet.confirmWithdrawal│
    │                                │    balance -= amount     │
    │                                │    locked -= amount      │
    │ 11. Notification: approved     │                          │
    │◄───────────────────────────────┤                          │
```

### 4.1. Отмена вывода

Если admin reject:

```
1. wallet.unlock() — возвращаем средства
2. withdrawal_request.status = REJECTED
3. Отправить email с причиной
```

---

## 5. Идемпотентность

### 5.1. КРИТИЧНО

Каждая финансовая операция **ДОЛЖНА** использовать `idempotency_key`.

**Без идемпотентности возможны:**
- Дублированные депозиты (webhook приходит дважды)
- Двойные выигрыши (win + retry)
- Потерянные средства (bet дважды на одну транзакцию)

### 5.2. Где idempotency_key хранится

В `payment_requests.idempotency_key` с UNIQUE constraint.

Перед выполнением mutating операции:

```typescript
async credit(input: CreditInput): Promise<CreditResult> {
  // 1. Check duplicate
  const existing = await this.ledgerRepo.findByIdempotencyKey(input.idempotencyKey)
  if (existing) {
    return {
      balanceBefore: existing.balanceBefore,
      balanceAfter: existing.balanceAfter,
      duplicate: true,
    }
  }
  
  // 2. Perform operation в transaction
  return this.prisma.$transaction(async (tx) => {
    const wallet = await tx.walletAccount.findUnique({
      where: { userId_currency: { userId: input.userId, currency: input.currency } },
    })
    
    // 3. Optimistic lock check
    const updated = await tx.walletAccount.updateMany({
      where: {
        userId: input.userId,
        currency: input.currency,
        version: wallet.version,  // ⚠️ version match required
        balance: { gte: input.amount },  // ⚠️ sufficient funds
      },
      data: {
        balance: { increment: input.amount },
        version: { increment: 1 },
      },
    })
    
    if (updated.count === 0) {
      throw new OptimisticLockError()  // retry logic kicks in
    }
    
    // 4. Create ledger entry
    const entry = await tx.ledgerEntry.create({
      data: {
        userId: input.userId,
        currency: input.currency,
        type: input.type,
        amount: input.amount,
        balanceBefore: wallet.balance,
        balanceAfter: new Decimal(wallet.balance).plus(input.amount).toString(),
        idempotencyKey: input.idempotencyKey,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    })
    
    return { balanceBefore: wallet.balance, balanceAfter: entry.balanceAfter }
  })
}
```

### 5.3. Конвенции ключей

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

### 5.4. Retry logic

```typescript
async creditWithRetry(input: CreditInput, maxRetries = 3): Promise<CreditResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.credit(input)
    } catch (err) {
      if (err instanceof OptimisticLockError && attempt < maxRetries) {
        // exponential backoff
        await new Promise(r => setTimeout(r, 50 * attempt * attempt))
        continue
      }
      throw err
    }
  }
  throw new MaxRetriesExceededError()
}
```

---

## 6. Webhook Handling

### 6.1. Всегда сохранять raw callback

```typescript
async processWebhook(provider: string, rawBody: string, headers: Record<string, string>) {
  // 1. Save RAW callback BEFORE processing
  const callback = await this.prisma.paymentCallback.create({
    data: {
      provider,
      rawBody,
      headers: headers as any,
      receivedAt: new Date(),
      processed: false,
    },
  })
  
  try {
    // 2. Verify signature
    const adapter = this.getAdapter(provider)
    const isValid = adapter.verifyWebhookSignature(rawBody, headers['x-signature'])
    if (!isValid) {
      throw new InvalidSignatureError()
    }
    
    // 3. Parse event
    const event = adapter.parseWebhook(rawBody)
    
    // 4. Process event
    await this.processWebhookEvent(provider, event, callback.id)
    
    // 5. Mark processed
    await this.prisma.paymentCallback.update({
      where: { id: callback.id },
      data: { processed: true, processedAt: new Date() },
    })
    
    return { ok: true }
  } catch (err) {
    // ⚠️ Не делаем retry автоматически — оставляем для cron reconcile
    logger.error({ err, callbackId: callback.id }, 'Webhook processing failed')
    throw err  // Но возвращаем 200 OK провайдеру (см. ниже)
  }
}
```

### 6.2. Возвращать 200 OK всегда

Даже при ошибке возвращаем 200 OK, чтобы провайдер не делал retry:

```typescript
@Post('webhooks/:provider')
async handleWebhook() {
  try {
    return await this.paymentsService.processWebhook(...)
  } catch (err) {
    // Можно логировать, но 200 уже отправлен
    return { ok: true }
  }
}
```

### 6.3. Reconciliation job (BullMQ cron)

Если webhook потерялся, ежечасный job сверяет pending payments:

```typescript
@Cron(CronExpression.EVERY_HOUR)
async reconcilePendingPayments() {
  const pending = await this.prisma.paymentRequest.findMany({
    where: {
      status: 'PROCESSING',
      createdAt: { lt: subMinutes(new Date(), 30) },
    },
  })
  
  for (const request of pending) {
    const adapter = this.getAdapter(request.provider)
    const status = await adapter.checkDepositStatus(request.externalId)
    
    if (status.status === 'completed') {
      await this.paymentsService.confirmDeposit(request.id)
    } else if (status.status === 'expired' || status.status === 'failed') {
      await this.paymentsService.markFailed(request.id)
    }
  }
}
```

---

## 7. Сценарии ошибок

### 7.1. Invalid Webhook Signature

```
1. Return 400 Bad Request
2. Log to security audit
3. НЕ сохранять в payment_callbacks.processed = true
4. Может указывать на spoofing — alert
```

### 7.2. Duplicate Webhook (платёж уже подтверждён)

```
1. Вернуть 200 OK
2. Просто записать callback (processed = true)
3. Не делать повторный credit
```

### 7.3. Insufficient Funds на стороне провайдера (withdrawal)

```
1. Откатить wallet.lock (unlock)
2. withdrawal_status = FAILED
3. Email пользователю
```

### 7.4. Provider Timeout

```
1. Обновить payment_status = PROCESSING (всё ещё ждём)
2. Reconciliation job подхватит через час
3. Если после 24 часов — manual review
```

### 7.5. Network Error при outgoing call

```
1. Retry с exponential backoff
2. До 5 попыток
3. Если всё fail — manual review / queue
```

---

## 8. KYC Enforcement

### 8.1. Deposit до лимита

```typescript
async createDeposit(input: CreateDepositInput) {
  const kycStatus = await this.kycFacade.getStatus(input.userId)
  
  if (kycStatus !== 'approved') {
    // Считаем RUB-эквивалент
    const totalDepositRub = await this.paymentsRepo.sumDepositsByUserSinceRegistration(input.userId)
    
    const newTotalRub = money.add(totalDepositRub, await this.exchangeService.toRub(input.amount, input.currency))
    
    if (newTotalRub.gt(env.KYC_DEPOSIT_LIMIT_RUB)) {
      throw new KycRequiredError(
        `KYC required. Limit: ${env.KYC_DEPOSIT_LIMIT_RUB} RUB, used: ${totalDepositRub} RUB`
      )
    }
  }
  
  // ... создание депозита
}
```

### 8.2. Withdrawal — всегда требует KYC

```typescript
async createWithdrawal(input: CreateWithdrawalInput) {
  const kycStatus = await this.kycFacade.getStatus(input.userId)
  
  if (kycStatus !== 'approved') {
    throw new KycRequiredError('Withdrawal requires KYC verification')
  }
  
  // ... создание withdrawal
}
```

---

## 9. Аудит и Logging

Каждое действие логируется:

```typescript
logger.info({
  module: 'payments',
  action: 'deposit_completed',
  userId: input.userId,
  provider: 'rukassa',
  amount: input.amount,
  currency: input.currency,
  paymentRequestId: payment.id,
  externalId: payment.externalId,
}, 'Deposit completed')
```

Логируемые события:

| Event | Level |
|-------|-------|
| `deposit_initiated` | info |
| `deposit_completed` | info |
| `deposit_failed` | warn |
| `withdrawal_requested` | info |
| `withdrawal_approved` | info |
| `withdrawal_rejected` | info |
| `webhook_received` | info |
| `webhook_signature_invalid` | warn |
| `idempotency_duplicate_hit` | warn |

---

## 10. Руководство по добавлению нового провайдера

### Шаг 1: Реализовать интерфейс

```typescript
// payments/infrastructure/adapters/newprovider.adapter.ts
@Injectable()
export class NewProviderAdapter implements PaymentProvider {
  readonly name = 'newprovider' as const
  
  async createDeposit(input: CreateDepositInput) { ... }
  async checkDepositStatus(externalId: string) { ... }
  // ...
}
```

### Шаг 2: Добавить env-переменные

```bash
NEWPROVIDER_API_KEY=...
NEWPROVIDER_WEBHOOK_URL=...
```

### Шаг 3: Зарегистрировать в DI

```typescript
// payments/payments.module.ts
providers: [
  RukassaAdapter,
  NowPaymentsAdapter,
  NewProviderAdapter,
  // фабрика которая выбирает адаптер по имени
]
```

### Шаг 4: Добавить в PaymentMethod enum

```typescript
// shared-types/payment.ts
export type PaymentMethod = 'card' | 'sbp' | 'p2p' | 'usdt_trc20' | 'btc' | ... | 'newprovider_method'
```

### Шаг 5: Обновить frontend DepositModal

Добавить кнопку метода на UI.

### Шаг 6: Тесты

- Mock адаптер через `vi.mock()`
- Test webhook signature verification
- Test idempotency

---

> **Главный принцип:** деньги идут только через **idempotency_key + wallet facade**, никогда напрямую через prisma.
