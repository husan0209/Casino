# ТЗ — Часть 3. Wallet, Fiat/Crypto Payments, Transaction Ledger

> Третья часть ТЗ casino-платформы. Описывает финансовое ядро: мультивалютный кошелёк, двойной ledger, интеграции с Rukassa (фиат) и NOWPayments (крипто), выводы, конвертации и admin-операции с балансом.
>
> Всего ТЗ разбито на **7 частей**:
>
> 1. **Общая архитектура и foundation** — [tz-part-1-foundation.md](tz-part-1-foundation.md)
> 2. **Backend Core: Auth, Users, KYC, RBAC** — [tz-part-2-auth-users-kyc-rbac.md](tz-part-2-auth-users-kyc-rbac.md)
> 3. **Wallet, Fiat/Crypto Payments, Transaction Ledger** ← текущая часть
> 4. **Casino Providers и Game Session Layer** — [tz-part-4-casino-providers.md](tz-part-4-casino-providers.md)
> 5. **Frontend Web: витрина, личный кабинет, кошелёк, история**
> 6. **Admin Panel, Support, Referral System**
> 7. **DevOps, Security, Logging, QA, Release Prep**

---

## Содержание

1. [Цель этапа](#1-цель-этапа)
2. [Архитектурные принципы финансового модуля](#2-архитектурные-принципы-финансового-модуля)
3. [Домен Wallet](#3-домен-wallet)
4. [Домен Payments](#4-домен-payments)
5. [Интеграция с Rukassa](#5-интеграция-с-rukassa)
6. [Интеграция с NOWPayments](#6-интеграция-с-nowpayments)
7. [Вывод средств](#7-вывод-средств)
8. [Конвертация валют (backend-only)](#8-конвертация-валют-backend-only)
9. [Admin операции с балансом](#9-admin-операции-с-балансом)
10. [Просмотр транзакций в админке](#10-просмотр-транзакций-в-админке)
11. [Events (события)](#11-events-события)
12. [Webhook security](#12-webhook-security)
13. [Scheduled Jobs](#13-scheduled-jobs)
14. [Технические задачи Части 3](#14-технические-задачи-части-3)
15. [Приёмка кассы: первые 90 секунд](#15-приёмка-кассы-первые-90-секунд)
16. [Что НЕ делать в Части 3](#16-что-не-делать-в-части-3)

---

## 1. Цель этапа

Эта часть описывает полную реализацию финансового ядра платформы:

- мультивалютный кошелёк пользователя;
- ledger (журнал транзакций с двойной записью);
- интеграция с Rukassa для фиатных платежей (MVP: RUB);
- интеграция с NOWPayments для криптовалютных платежей (MVP: USDT_TRC20, BTC);
- вывод средств;
- внутренние курсы для KYC и admin-отчётов (не для игрока);
- idempotency;
- KYC enforcement при платежах;
- admin-операции с балансами.

> ⚠️ Это самая критичная часть проекта. Ошибки в кошельке и платежах приводят к прямым финансовым потерям. Каждый use case должен быть реализован строго по описанию.

---

## 2. Архитектурные принципы финансового модуля

### 2.1. Деньги — всегда строки

Во всей системе денежные значения:

- в базе данных хранятся как `DECIMAL(20,8)`;
- в коде обрабатываются через библиотеку `decimal.js`;
- в API передаются как строки;
- **никогда** не используется `number` / `float` для денежных сумм.

### 2.2. Idempotency

Каждая финансовая операция должна иметь `idempotency_key`.

Если операция с таким ключом уже была выполнена — возвращать результат предыдущей операции без повторного выполнения.

Это критично потому что:

- провайдеры платежей могут отправить callback дважды;
- игровые провайдеры могут повторить bet/win запрос;
- сетевые ошибки могут привести к повторной отправке запроса.

### 2.3. Optimistic Locking

Каждый кошелёк имеет поле `version`.

При изменении баланса:

- читаем текущую `version`;
- обновляем баланс с условием `WHERE version = expected_version`;
- инкрементируем `version`;
- если строк обновлено 0 — конфликт, повторяем операцию.

### 2.4. Атомарность

Все операции изменения баланса выполняются внутри database transaction.

Внутри одной транзакции:

- проверяется баланс;
- обновляется баланс;
- создаётся запись в ledger;
- проверяется idempotency.

### 2.5. Аудит

Каждое изменение баланса создаёт запись в ledger.

**Ledger — append-only.** Записи никогда не удаляются и не изменяются.

Баланс в `wallet_accounts` — это кэш, который в любой момент можно пересчитать из ledger.

---

## 3. Домен Wallet

### 3.1. Сущности базы данных

#### Таблица `wallet_accounts`

```
id                  UUID, PK
user_id             UUID, FK -> users.id
currency            VARCHAR(16), not null
balance             DECIMAL(20,8), not null, default 0, CHECK >= 0
locked              DECIMAL(20,8), not null, default 0, CHECK >= 0
version             BIGINT, not null, default 0
created_at          TIMESTAMPTZ, default now()
updated_at          TIMESTAMPTZ, default now()

UNIQUE(user_id, currency)
INDEX(user_id)
```

**Поле `locked`** — зарезервированные средства. Используется когда:

- пользователь запросил вывод, но он ещё не обработан;
- средства заморожены по решению администратора.

**Доступный баланс:**

```
available = balance - locked
```

#### Таблица `ledger_entries`

```
id                  UUID, PK
transaction_id      UUID, not null
wallet_account_id   UUID, FK -> wallet_accounts.id
type                VARCHAR(32), not null
amount              DECIMAL(20,8), not null
balance_before      DECIMAL(20,8), not null
balance_after       DECIMAL(20,8), not null
idempotency_key     VARCHAR(255), UNIQUE
description         TEXT, nullable
metadata            JSONB, default '{}'
created_at          TIMESTAMPTZ, default now()

INDEX(wallet_account_id)
INDEX(transaction_id)
INDEX(idempotency_key)
INDEX(created_at)
INDEX(type)
```

**Значения `type`:**

```
DEPOSIT
WITHDRAWAL
WITHDRAWAL_LOCK
WITHDRAWAL_UNLOCK
WITHDRAWAL_CONFIRM
BET
WIN
ROLLBACK
BONUS
ADMIN_CREDIT
ADMIN_DEBIT
REFERRAL_REWARD
CONVERSION_DEBIT
CONVERSION_CREDIT
```

**Правила `amount`:**

- положительное значение — зачисление на баланс;
- отрицательное значение — списание с баланса;
- `balance_before` и `balance_after` фиксируют состояние баланса до и после операции.

### 3.2. Поддерживаемые валюты

#### MVP (живые платежи и кошельки)

```
RUB         — российский рубль (фиат через Rukassa)
USDT_TRC20  — Tether на сети TRON (NOWPayments)
BTC         — Bitcoin (NOWPayments)
```

#### Phase 2 (типы, schema, GeoConfig готовы; PSP подключаются по гео)

```
UAH         — украинская гривна
BYN         — белорусский рубль (никогда не «белорусский RUB» в UI)
KZT         — казахстанский тенге
UZS         — узбекский сум
```

#### Не в релизе (зарезервировать в enum/schema при необходимости, не показывать игроку)

```
TON, TRX, LTC, ETH, USDT_ERC20, USDT_BEP20
```

Пользователь может иметь несколько кошельков — по одному на каждую валюту.

Кошельки создаются лениво — при первом пополнении или при первом запросе баланса.

**Правило UI (см. [tz-part-5](tz-part-5-frontend-web.md) §2.3–2.7):** касса не конвертирует между кошельками; депозит в валюте X зачисляется только в кошелёк X; ставки и вывод — в той же валюте.

### 3.3. Wallet Module — Use Cases

#### UC-WALLET-01: Получить все балансы

```
GET /api/v1/wallet/balances
Authorization: Bearer <token>
```

**Ответ:**

```json
{
  "success": true,
  "data": [
    {
      "currency": "RUB",
      "balance": "15000.00",
      "locked": "0.00",
      "available": "15000.00"
    },
    {
      "currency": "USDT_TRC20",
      "balance": "250.50000000",
      "locked": "50.00000000",
      "available": "200.50000000"
    }
  ]
}
```

**Правила:**

- возвращать только кошельки с ненулевым балансом или те, которые были когда-либо созданы;
- для каждого вычислять `available = balance - locked`.

---

#### UC-WALLET-02: Получить баланс по валюте

```
GET /api/v1/wallet/balances/:currency
```

**Правила:**

- если кошелёк не существует — создать с нулевым балансом и вернуть.

---

#### UC-WALLET-03: Получить историю транзакций

```
GET /api/v1/wallet/transactions
```

**Параметры запроса:**

```
page        — номер страницы, default 1
per_page    — элементов на странице, default 20, max 100
currency    — фильтр по валюте, optional
type        — фильтр по типу транзакции, optional
from        — дата начала, optional
to          — дата конца, optional
```

**Ответ:**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "transaction_id": "...",
      "type": "DEPOSIT",
      "amount": "1000.00",
      "currency": "RUB",
      "balance_before": "500.00",
      "balance_after": "1500.00",
      "description": "Пополнение через Rukassa",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

---

#### UC-WALLET-04: Внутреннее зачисление (credit)

Внутренний метод, не является публичным endpoint. Вызывается из payment module, game module, bonus module, admin module.

**Входные данные:**

```typescript
{
  userId: string
  currency: string
  amount: string            // положительная строка
  type: LedgerEntryType
  idempotencyKey: string
  description?: string
  metadata?: object
}
```

**Алгоритм:**

```
1. Проверить idempotency_key — если уже есть, вернуть предыдущий результат
2. Начать database transaction
3. Найти или создать wallet_account для (userId, currency)
4. Прочитать текущий balance и version
5. Вычислить balance_after = balance_before + amount
6. UPDATE wallet_accounts SET balance = balance + amount, version = version + 1
   WHERE id = wallet_id AND version = expected_version
7. Если обновлено 0 строк — version conflict, retry (до 3 раз)
8. INSERT в ledger_entries
9. Commit transaction
10. Вернуть ledger entry
```

---

#### UC-WALLET-05: Внутреннее списание (debit)

Внутренний метод.

**Входные данные:**

```typescript
{
  userId: string
  currency: string
  amount: string
  type: LedgerEntryType
  idempotencyKey: string
  description?: string
  metadata?: object
}
```

**Алгоритм:**

```
1. Проверить idempotency_key
2. Начать database transaction
3. Найти wallet_account
4. Если не найден — ошибка WALLET_NOT_FOUND
5. Вычислить available = balance - locked
6. Если available < amount — ошибка INSUFFICIENT_FUNDS
7. balance_after = balance - amount
8. UPDATE wallet_accounts SET balance = balance - amount, version = version + 1
   WHERE id = wallet_id AND version = expected_version AND balance >= amount
9. Если обновлено 0 строк — conflict или insufficient funds, retry
10. INSERT в ledger_entries с отрицательным amount
11. Commit
12. Вернуть ledger entry
```

---

#### UC-WALLET-06: Заблокировать средства (lock)

Используется при запросе вывода.

```
1. Начать transaction
2. Прочитать wallet
3. Проверить available >= amount
4. UPDATE wallet_accounts SET locked = locked + amount, version = version + 1
   WHERE id = wallet_id AND version = expected_version
5. INSERT ledger_entry с type = WITHDRAWAL_LOCK
6. Commit
```

---

#### UC-WALLET-07: Разблокировать средства (unlock)

Используется при отмене вывода.

```
1. Начать transaction
2. UPDATE wallet_accounts SET locked = locked - amount, version = version + 1
3. INSERT ledger_entry с type = WITHDRAWAL_UNLOCK
4. Commit
```

---

#### UC-WALLET-08: Подтвердить списание заблокированных средств

Используется при подтверждении вывода.

```
1. Начать transaction
2. UPDATE wallet_accounts SET
     balance = balance - amount,
     locked = locked - amount,
     version = version + 1
3. INSERT ledger_entry с type = WITHDRAWAL_CONFIRM
4. Commit
```

---

## 4. Домен Payments

### 4.1. Сущности базы данных

#### Таблица `payment_requests`

```
id                  UUID, PK
user_id             UUID, FK -> users.id
type                ENUM(deposit, withdrawal)
status              ENUM(pending, processing, completed, failed, cancelled, expired)
provider            ENUM(rukassa, nowpayments, manual)
method              VARCHAR(64), nullable
currency            VARCHAR(16), not null
amount              DECIMAL(20,8), not null
amount_rub          DECIMAL(20,2), nullable
fee                 DECIMAL(20,8), default 0
external_id         VARCHAR(255), nullable
external_status     VARCHAR(64), nullable
payment_url         TEXT, nullable
destination         JSONB, nullable
idempotency_key     VARCHAR(255), UNIQUE
metadata            JSONB, default '{}'
error_message       TEXT, nullable
expires_at          TIMESTAMPTZ, nullable
completed_at        TIMESTAMPTZ, nullable
created_at          TIMESTAMPTZ, default now()
updated_at          TIMESTAMPTZ, default now()

INDEX(user_id)
INDEX(status)
INDEX(provider)
INDEX(external_id)
INDEX(created_at)
```

#### Таблица `payment_callbacks`

Все входящие callback-и от провайдеров сохраняются в raw виде.

```
id                  UUID, PK
provider            VARCHAR(32), not null
external_id         VARCHAR(255), nullable
payment_request_id  UUID, nullable, FK -> payment_requests.id
raw_headers         JSONB
raw_body            TEXT
ip_address          VARCHAR(64)
processed           BOOLEAN, default false
processing_result   TEXT, nullable
created_at          TIMESTAMPTZ, default now()

INDEX(provider)
INDEX(external_id)
INDEX(processed)
```

### 4.2. Общие правила платежей

#### Лимиты

**MVP — RUB (фиат):**

| Операция | Мин | Макс |
|---|---|---|
| Депозит | 100 ₽ | 500 000 ₽ |
| Вывод | 500 ₽ | 200 000 ₽ |

**MVP — USDT_TRC20 / BTC:** мин/макс задаются в env/admin; для BTC сумма депозита = **факт** входящего платежа (без пресетов).

**Phase 2:** отдельные min/max per currency (см. пресеты в [tz-part-5](tz-part-5-frontend-web.md) §2.5). Хранить в admin settings или `GeoConfig`.

#### KYC enforcement

Перед созданием депозита:

```
Считаем total_deposited_rub = сумма всех completed депозитов в RUB-эквиваленте
Если total_deposited_rub + new_deposit_rub > KYC_DEPOSIT_LIMIT_RUB И kyc_status != approved:
  → вернуть ошибку KYC_REQUIRED
```

**Отображение лимита игроку:** API дополнительно отдаёт `kyc_limit_remaining` в запрошенной валюте (конвертация из RUB только для UI, не для списания/зачисления).

Перед созданием вывода:

```
Если kyc_status != approved:
  → вернуть ошибку KYC_REQUIRED
```

> Вывод всегда требует KYC, независимо от суммы.

#### Geo и методы оплаты

Один фронт, методы режутся по **гео + активной валюте** (см. [tz-part-5](tz-part-5-frontend-web.md) §2.6, §10.2).

```
GET /api/v1/geo/config
```

**Ответ (пример MVP RU):**

```json
{
  "success": true,
  "data": {
    "defaultCurrency": "RUB",
    "enabledFiat": ["RUB"],
    "enabledCrypto": ["USDT_TRC20", "BTC"],
    "legalCountry": "RU",
    "paymentMethods": [
      { "id": "sbp", "label": "СБП", "currency": "RUB", "type": "fiat" },
      { "id": "card", "label": "Карта", "currency": "RUB", "type": "fiat" },
      { "id": "p2p", "label": "P2P", "currency": "RUB", "type": "fiat" }
    ]
  }
}
```

Правила:

- RU и UA методы **никогда** в одном списке;
- для залогиненного пользователя активный кошелёк важнее IP;
- последний успешный метод (`last_payment_method` в профиле или отдельное поле) — первый в списке;
- крипта в MVP доступна как «Ещё способы» при активном фиате.

#### Fee

На MVP:

- комиссия депозита: 0%;
- комиссия вывода: настраиваемая через env/admin, на старте 0%.

#### Конвертация в RUB (только compliance / admin)

Для KYC лимита и admin-отчётов нужно хранить RUB-эквивалент каждого депозита.

Для крипто-депозитов:

- использовать курс из NOWPayments API на момент создания/зачисления платежа;
- сохранять в `amount_rub` в `payment_requests` / metadata транзакции.

> **Не использовать** для игрока: общий баланс в RUB, автоконвертацию при депозите/выводе/игре, внутренний обменник. См. [tz-part-5](tz-part-5-frontend-web.md) §10.4.

---

## 5. Интеграция с Rukassa

### 5.1. Общая информация

Rukassa — платёжный агрегатор для СНГ.

Поддерживает:

- банковские карты;
- СБП;
- электронные кошельки;
- P2P.

### 5.2. Флоу депозита через Rukassa

```
1. Пользователь нажимает "Пополнить" и выбирает сумму в RUB
2. Backend создаёт payment_request
3. Backend вызывает Rukassa API для создания платежа
4. Rukassa возвращает payment_url
5. Backend сохраняет external_id и payment_url
6. Backend возвращает payment_url на frontend
7. Frontend редиректит пользователя на payment_url
8. Пользователь оплачивает
9. Rukassa отправляет callback на наш webhook endpoint
10. Backend получает callback
11. Backend сохраняет raw callback в payment_callbacks
12. Backend верифицирует подпись callback
13. Backend находит payment_request по external_id
14. Backend проверяет статус
15. Если успешно — вызывает wallet.credit
16. Обновляет payment_request статус на completed
17. Отправляет уведомление пользователю
```

### 5.3. Rukassa Adapter

Создать изолированный adapter/client для Rukassa.

```typescript
// Интерфейс
interface RukassaClient {
  createPayment(params: {
    amount: string        // сумма в RUB
    orderId: string       // наш payment_request.id
    method?: string       // способ оплаты
    webhookUrl: string
    successUrl: string
    failUrl: string
  }): Promise<{
    paymentId: string     // external_id
    paymentUrl: string    // куда редиректить
  }>

  verifyCallback(headers: object, body: string): boolean

  getPaymentStatus(paymentId: string): Promise<{
    status: string
    amount: string
  }>
}
```

**Правила реализации:**

- все вызовы к Rukassa обёрнуты в try/catch с логированием;
- timeout на HTTP вызовы: 30 секунд;
- при ошибке API — `payment_request` остаётся в статусе `pending`;
- webhook URL: `POST /api/v1/payments/webhooks/rukassa`.

### 5.4. Rukassa Deposit Use Cases

#### UC-PAY-01: Создать фиатный депозит

```
POST /api/v1/payments/deposit/fiat
Authorization: Bearer <token>
```

**Входные данные:**

```json
{
  "amount": "1000.00",
  "currency": "RUB",
  "method": "card"
}
```

`currency` — валюта активного кошелька / geo (обязательно). `method` — id из `geo.config.paymentMethods`.

**Алгоритм:**

```
1. Валидировать amount (>= 100, <= 500000)
2. Проверить KYC лимит
3. Проверить что у пользователя нет pending депозита (optional, для защиты от спама)
4. Сгенерировать idempotency_key
5. Создать payment_request со статусом pending
6. Вызвать rukassaClient.createPayment
7. Если Rukassa вернула ошибку — обновить статус на failed, вернуть ошибку
8. Сохранить external_id и payment_url
9. Вернуть payment_url на frontend
```

**Ответ:**

```json
{
  "success": true,
  "data": {
    "payment_request_id": "...",
    "payment_url": "https://pay.rukassa.is/..."
  }
}
```

**Ошибки:**

- `VALIDATION_ERROR` — невалидная сумма
- `KYC_REQUIRED` — превышен лимит
- `PAYMENT_PROVIDER_ERROR` — Rukassa недоступна

---

#### UC-PAY-02: Обработать Rukassa callback

```
POST /api/v1/payments/webhooks/rukassa
```

**Алгоритм:**

```
1. Получить raw body и headers
2. Сохранить в payment_callbacks (raw_headers, raw_body, ip_address)
3. Верифицировать подпись
4. Если подпись невалидна:
   a. Пометить callback как processed = true, result = 'invalid_signature'
   b. Залогировать warning
   c. Вернуть 200 OK (чтобы Rukassa не ретраила)
5. Извлечь external_id и status из body
6. Найти payment_request по external_id
7. Если не найден — залогировать error, вернуть 200 OK
8. Если payment_request.status уже completed — idempotent, вернуть 200 OK
9. Если Rukassa status = success:
   a. Вызвать walletService.credit({
        userId: payment_request.user_id,
        currency: 'RUB',
        amount: payment_request.amount,
        type: 'DEPOSIT',
        idempotencyKey: 'deposit_' + payment_request.id,
        description: 'Пополнение через Rukassa',
        metadata: { provider: 'rukassa', external_id: ... }
      })
   b. Обновить payment_request.status = completed
   c. Обновить payment_request.completed_at = now()
   d. Emit event DEPOSIT_COMPLETED
10. Если Rukassa status = failed:
    a. Обновить payment_request.status = failed
    b. Сохранить error_message
11. Пометить callback как processed = true
12. Вернуть 200 OK
```

> ⚠️ **Критично:**
>
> - всегда возвращать 200 OK провайдеру, даже при ошибках на нашей стороне;
> - логировать все ошибки;
> - никогда не зачислять средства без валидной подписи.

### 5.5. Rukassa Вывод

На MVP вывод через Rukassa можно сделать двумя способами:

**Вариант A: Ручной вывод через админку.**

Пользователь создаёт заявку на вывод, админ видит её в админке и выполняет перевод вручную, после чего подтверждает.

**Вариант B: Автоматический через API Rukassa.**

Если Rukassa поддерживает массовые выплаты через API — интегрировать.

**Рекомендация для MVP:** Вариант A + готовность к B.

То есть:

- пользователь создаёт withdrawal request;
- средства блокируются;
- admin видит заявку;
- admin подтверждает или отклоняет;
- при подтверждении — средства списываются, при отклонении — разблокируются.

---

## 6. Интеграция с NOWPayments

### 6.1. Общая информация

NOWPayments — крипто-платёжный процессор.

Поддерживает:

- приём криптовалюты;
- callback-и при получении средств;
- мультивалютность.

### 6.2. Флоу крипто-депозита

```
1. Пользователь выбирает валюту (USDT_TRC20, BTC, TON, TRX, LTC)
2. Пользователь вводит сумму
3. Backend вызывает NOWPayments API для создания платежа
4. NOWPayments возвращает:
   - pay_address (адрес для отправки крипты)
   - pay_amount (сумма к оплате в крипто)
   - payment_id (external_id)
   - expiration_estimate_date
5. Backend создаёт payment_request
6. Backend возвращает пользователю адрес и сумму
7. Пользователь отправляет крипту на адрес
8. NOWPayments отправляет callback/IPN
9. Backend обрабатывает callback
10. При подтверждении — зачисляет на кошелёк
```

### 6.3. NOWPayments Adapter

```typescript
interface NOWPaymentsClient {
  createPayment(params: {
    priceAmount: string       // сумма в оригинальной валюте
    priceCurrency: string     // валюта цены (может быть USD/RUB)
    payCurrency: string       // в чём платит пользователь (btc, trx, etc)
    orderId: string           // наш payment_request.id
    ipnCallbackUrl: string
  }): Promise<{
    paymentId: string
    payAddress: string
    payAmount: string
    payCurrency: string
    expirationEstimateDate: string
  }>

  getPaymentStatus(paymentId: string): Promise<{
    paymentStatus: string     // waiting, confirming, confirmed, sending, finished, failed, expired
    actuallyPaid: string
    outcomeAmount: string
  }>

  getEstimatePrice(params: {
    amount: string
    currencyFrom: string
    currencyTo: string
  }): Promise<{
    estimatedAmount: string
  }>

  verifyIPN(body: object, signature: string): boolean
}
```

**Маппинг наших валют на NOWPayments:**

```
USDT_TRC20 → usdttrc20
BTC        → btc
TON        → ton
TRX        → trx
LTC        → ltc
```

### 6.4. NOWPayments Deposit Use Cases

#### UC-PAY-03: Создать крипто-депозит

```
POST /api/v1/payments/deposit/crypto
Authorization: Bearer <token>
```

**Входные данные:**

```json
{
  "amount": "100.00",
  "currency": "USDT_TRC20"
}
```

**Алгоритм:**

```
1. Валидировать amount и currency
2. Маппинг currency на NOWPayments код
3. Получить estimate RUB-эквивалента (для KYC проверки)
4. Проверить KYC лимит с учётом RUB-эквивалента
5. Сгенерировать idempotency_key
6. Вызвать NOWPayments API createPayment
7. Создать payment_request:
   - status = pending
   - provider = nowpayments
   - currency = USDT_TRC20
   - amount = введённая сумма
   - amount_rub = RUB-эквивалент
   - external_id = NOWPayments payment_id
   - expires_at = expiration_estimate_date
   - metadata = { pay_address, pay_amount, pay_currency }
8. Вернуть данные для оплаты
```

**Ответ:**

```json
{
  "success": true,
  "data": {
    "payment_request_id": "...",
    "pay_address": "TXyz...",
    "pay_amount": "100.00000000",
    "pay_currency": "usdttrc20",
    "expires_at": "2024-01-01T01:00:00Z"
  }
}
```

---

#### UC-PAY-04: Обработать NOWPayments IPN callback

```
POST /api/v1/payments/webhooks/nowpayments
```

**Алгоритм:**

```
1. Получить raw body и headers
2. Сохранить в payment_callbacks
3. Верифицировать IPN подпись через HMAC
4. Если невалидна — залогировать, вернуть 200 OK
5. Извлечь payment_id и payment_status
6. Найти payment_request по external_id = payment_id
7. Если не найден — залогировать, вернуть 200 OK
8. Обработать по статусу:

   waiting → ничего не делаем, обновляем external_status

   confirming → обновляем external_status (транзакция в мемпуле)

   confirmed → обновляем external_status

   finished → это финальный успешный статус
     a. Если payment_request.status уже completed — skip (idempotent)
     b. Зачислить на кошелёк:
        walletService.credit({
          userId: payment_request.user_id,
          currency: payment_request.currency,
          amount: actually_paid_amount,
          type: 'DEPOSIT',
          idempotencyKey: 'deposit_' + payment_request.id,
          description: 'Крипто-пополнение через NOWPayments',
          metadata: { provider: 'nowpayments', external_id, actually_paid }
        })
     c. payment_request.status = completed
     d. payment_request.completed_at = now()
     e. Emit event DEPOSIT_COMPLETED

   failed → payment_request.status = failed

   expired → payment_request.status = expired

9. Пометить callback как processed
10. Вернуть 200 OK
```

> ⚠️ **Важно про `actually_paid`:** NOWPayments может прислать amount, отличающийся от запрошенного (пользователь отправил чуть больше или меньше). Зачислять нужно фактически полученную сумму `actually_paid`, а не запрошенную.

---

#### UC-PAY-05: Получить статус депозита

```
GET /api/v1/payments/deposit/:payment_request_id/status
Authorization: Bearer <token>
```

**Правила:**

- пользователь может видеть только свои `payment_request`;
- возвращать текущий `status`, `external_status`, `pay_address`, `pay_amount`.

**Ответ:**

```json
{
  "success": true,
  "data": {
    "id": "...",
    "status": "pending",
    "external_status": "waiting",
    "currency": "BTC",
    "amount": "0.005",
    "pay_address": "bc1q...",
    "pay_amount": "0.00500000",
    "created_at": "...",
    "expires_at": "..."
  }
}
```

---

## 7. Вывод средств

### 7.1. Общий флоу вывода

```
1. Пользователь запрашивает вывод
2. Backend проверяет KYC, баланс, лимиты
3. Backend блокирует средства на кошельке (lock)
4. Создаётся payment_request с type = withdrawal, status = pending
5. Admin видит заявку в админке
6. Admin принимает решение:
   a. Approve → средства списываются (confirm), деньги переводятся
   b. Reject → средства разблокируются (unlock), заявка отменяется
```

#### UC-PAY-06: Создать заявку на вывод фиата

```
POST /api/v1/payments/withdrawal/fiat
Authorization: Bearer <token>
```

**Входные данные:**

```json
{
  "amount": "5000.00",
  "method": "card",
  "destination": {
    "card_number": "4111111111111111",
    "card_holder": "IVAN PETROV"
  }
}
```

**Алгоритм:**

```
1. Проверить KYC — если не approved, вернуть KYC_REQUIRED
2. Валидировать amount (>= 500, <= 200000)
3. Проверить available баланс в RUB
4. Если available < amount — INSUFFICIENT_FUNDS
5. Заблокировать средства: walletService.lock(userId, 'RUB', amount)
6. Создать payment_request:
   - type = withdrawal
   - status = pending
   - provider = manual (или rukassa если автовывод)
   - currency = RUB
   - amount = сумма
   - destination = { card_number: masked, card_holder }
7. Уведомить admin (через BullMQ)
8. Вернуть payment_request_id
```

**Маскирование карты:**

В базе хранить полный номер карты (зашифрованным), но в API ответах показывать только последние 4 цифры: `**** **** **** 1111`.

> В MVP можно хранить как есть в JSONB `destination`, но пометить в backlog задачу шифрования.

---

#### UC-PAY-07: Создать заявку на вывод крипты

```
POST /api/v1/payments/withdrawal/crypto
Authorization: Bearer <token>
```

**Входные данные:**

```json
{
  "amount": "100.00",
  "currency": "USDT_TRC20",
  "destination": {
    "wallet_address": "TXyz..."
  }
}
```

**Алгоритм:**

```
1. Проверить KYC
2. Валидировать amount и currency
3. Валидировать wallet_address формат (базовая проверка по паттерну для каждой сети)
4. Проверить available баланс
5. Заблокировать средства
6. Создать payment_request
7. Уведомить admin
```

**Паттерны адресов (MVP):**

```
BTC         → начинается с 1, 3, bc1 — длина 26-62
USDT_TRC20  → начинается с T — длина 34
```

TRC20-адрес не должен проходить валидацию BTC и наоборот.

**Зачисление крипто-депозита:** фактическая сумма входящего платежа; не требовать совпадения до копейки с запрошенной суммой.

---

#### UC-PAY-08: Получить список заявок на вывод (User)

```
GET /api/v1/payments/withdrawals
Authorization: Bearer <token>
```

**Параметры:** `page`, `per_page`, `status`, `currency`, `from`, `to`

---

#### UC-PAY-09: Отменить заявку на вывод (User)

```
POST /api/v1/payments/withdrawal/:id/cancel
Authorization: Bearer <token>
```

**Правила:**

- можно отменить только свою заявку;
- можно отменить только заявку в статусе `pending`;
- при отмене: разблокировать средства (unlock);
- обновить статус на `cancelled`.

### 7.2. Admin операции с выводами

#### UC-PAY-10: Получить список заявок на вывод (Admin)

```
GET /api/v1/admin/withdrawals
```

**Параметры:** `page`, `per_page`, `status`, `user_id`, `currency`, `from`, `to`

**Показывать:**

- данные пользователя;
- сумму и валюту;
- destination;
- KYC статус пользователя;
- дату создания;
- текущий статус.

---

#### UC-PAY-11: Одобрить вывод (Admin)

```
POST /api/v1/admin/withdrawals/:id/approve
```

```
1. Проверить что заявка в статусе pending
2. Вызвать walletService.confirmWithdrawal (списать заблокированные средства)
3. Обновить payment_request.status = completed
4. Записать в audit_log
5. Уведомить пользователя
```

---

#### UC-PAY-12: Отклонить вывод (Admin)

```
POST /api/v1/admin/withdrawals/:id/reject
```

**Входные данные:**

```json
{
  "reason": "Подозрительная активность"
}
```

```
1. Проверить что заявка в статусе pending
2. Вызвать walletService.unlock (разблокировать средства)
3. Обновить payment_request.status = cancelled
4. Сохранить error_message = reason
5. Записать в audit_log
6. Уведомить пользователя
```

---

## 8. Конвертация валют (backend-only)

### 8.1. Концепция

**Игроку конвертация недоступна.** Нет общего баланса, обменника, тихой конвертации при игре или выводе.

Внутренняя конвертация нужна **только** для:

- проверки KYC лимита (RUB-эквивалент суммарных депозитов);
- admin-дашборда и отчётности (GGR, депозиты, баланс пользователя в reporting currency);
- API `kyc_limit_remaining` в валюте, запрошенной фронтом (display-only).

### 8.2. Хранение курсов

#### Таблица `exchange_rates`

```
id              UUID, PK
currency_from   VARCHAR(16)
currency_to     VARCHAR(16)
rate            DECIMAL(20,8)
source          VARCHAR(32)
fetched_at      TIMESTAMPTZ

INDEX(currency_from, currency_to)
INDEX(fetched_at)
```

### 8.3. Обновление курсов

Создать BullMQ cron job:

- каждые 5 минут запрашивать курсы из NOWPayments API или открытого API (CoinGecko / CoinMarketCap);
- сохранять в `exchange_rates`;
- кешировать в Redis с TTL 5 минут.

#### UC-PAY-13: Получить текущие курсы (admin / internal)

```
GET /api/v1/admin/exchange-rates
Authorization: Bearer <admin_token>
```

Публичный endpoint для игрока **не нужен** в MVP. Фронт не показывает «≈ в рублях».

**Ответ:**

```json
{
  "success": true,
  "data": {
    "BTC_RUB": "8500000.00",
    "USDT_TRC20_RUB": "92.50"
  }
}
```

> TON/TRX/LTC курсы не нужны — валюты вне релиза.

---

## 9. Admin операции с балансом

#### UC-PAY-14: Ручное зачисление (Admin)

```
POST /api/v1/admin/wallet/:user_id/credit
```

**Входные данные:**

```json
{
  "amount": "500.00",
  "currency": "RUB",
  "reason": "Компенсация за технический сбой"
}
```

**Правила:**

- доступно только superadmin;
- вызывает `walletService.credit` с type = `ADMIN_CREDIT`;
- обязательная запись в `audit_log` с `reason`;
- обязательное уведомление пользователя.

---

#### UC-PAY-15: Ручное списание (Admin)

```
POST /api/v1/admin/wallet/:user_id/debit
```

**Входные данные:**

```json
{
  "amount": "500.00",
  "currency": "RUB",
  "reason": "Мошенническая активность — возврат средств"
}
```

**Правила:**

- доступно только superadmin;
- проверить достаточность баланса;
- вызывает `walletService.debit` с type = `ADMIN_DEBIT`;
- обязательная запись в `audit_log`.

---

## 10. Просмотр транзакций в админке

#### UC-PAY-16: Список транзакций (Admin)

```
GET /api/v1/admin/transactions
```

**Параметры:** `page`, `per_page`, `user_id`, `currency`, `type`, `status`, `from`, `to`

**Ответ включает:**

- ledger entry данные;
- информацию о пользователе;
- связанный `payment_request` если есть.

---

#### UC-PAY-17: Список платёжных запросов (Admin)

```
GET /api/v1/admin/payment-requests
```

**Параметры:** `page`, `per_page`, `user_id`, `type`, `status`, `provider`, `from`, `to`

---

#### UC-PAY-18: Детали платёжного запроса (Admin)

```
GET /api/v1/admin/payment-requests/:id
```

**Включает:**

- все поля `payment_request`;
- все связанные `payment_callbacks` (raw);
- связанные ledger entries;
- данные пользователя.

---

## 11. Events (события)

Модуль Payment должен эмитить следующие события через eventBus:

```
DEPOSIT_COMPLETED
  payload: { userId, amount, currency, paymentRequestId, isFirstDeposit, amountRub }

DEPOSIT_FAILED
  payload: { userId, paymentRequestId, reason }

WITHDRAWAL_REQUESTED
  payload: { userId, amount, currency, paymentRequestId }

WITHDRAWAL_COMPLETED
  payload: { userId, amount, currency, paymentRequestId }

WITHDRAWAL_CANCELLED
  payload: { userId, amount, currency, paymentRequestId, reason }
```

**Подписчики:**

- `referral module` слушает `DEPOSIT_COMPLETED` для начисления реферальных;
- `notification module` слушает все события для уведомлений;
- `kyc module` может слушать `DEPOSIT_COMPLETED` для пересчёта лимита.

---

## 12. Webhook security

### 12.1. Rukassa webhook

- проверять IP-адрес callback (whitelist IP Rukassa);
- проверять подпись (алгоритм согласно документации Rukassa);
- логировать все невалидные попытки.

### 12.2. NOWPayments IPN

- проверять HMAC signature (IPN Secret);
- проверять что `payment_id` соответствует нашему order;
- логировать все невалидные попытки.

### 12.3. Общий webhook endpoint security

- отдельный route без auth middleware;
- rate limit: 100 запросов в минуту с одного IP;
- все callback-и всегда сохраняются в raw виде до обработки.

---

## 13. Scheduled Jobs

### 13.1. Expire pending payments

BullMQ cron job, каждые 5 минут:

```
Найти все payment_requests где:
  status = pending
  AND type = deposit
  AND created_at < now() - interval '2 hours'

Для каждого:
  status = expired
```

Для крипто-платежей использовать `expires_at` из NOWPayments.

### 13.2. Exchange rate updater

BullMQ cron job, каждые 5 минут:

```
Запросить курсы из API
Сохранить в exchange_rates
Обновить Redis cache
```

### 13.3. Pending withdrawal reminder

BullMQ cron job, каждый час:

```
Если есть withdrawal requests в статусе pending более 24 часов:
  Уведомить admin
```

---

## 14. Технические задачи Части 3

### Блок A. Wallet Module

**Задачи:**

1. Создать `modules/wallet`.
2. Создать Prisma schema для `wallet_accounts` и `ledger_entries`.
3. Реализовать wallet repository с optimistic locking.
4. Реализовать WalletService с методами: credit, debit, lock, unlock, confirmWithdrawal.
5. Реализовать idempotency проверку.
6. Реализовать retry логику при version conflict.
7. Реализовать `GET /api/v1/wallet/balances`.
8. Реализовать `GET /api/v1/wallet/balances/:currency`.
9. Реализовать `GET /api/v1/wallet/transactions`.

**Критерий приёмки:**

- баланс корректно обновляется при credit/debit;
- дублированная операция с тем же `idempotency_key` не создаёт повторного зачисления;
- при недостаточном балансе — ошибка `INSUFFICIENT_FUNDS`;
- lock/unlock корректно работают;
- history с пагинацией и фильтрами работает.

---

### Блок B. Rukassa Integration

**Задачи:**

1. Создать `modules/payments` с общей структурой.
2. Создать RukassaClient adapter в `infrastructure/`.
3. Реализовать создание фиатного депозита.
4. Реализовать webhook endpoint для Rukassa.
5. Реализовать верификацию подписи Rukassa.
6. Реализовать сохранение raw callback.
7. Реализовать зачисление при успешном callback.
8. Создать Prisma schema для `payment_requests` и `payment_callbacks`.

**Критерий приёмки:**

- создание депозита возвращает `payment_url`;
- callback корректно зачисляет средства;
- повторный callback не дублирует зачисление;
- невалидная подпись логируется и отклоняется;
- все callback-и сохраняются в raw виде.

---

### Блок C. NOWPayments Integration

**Задачи:**

1. Создать NOWPaymentsClient adapter.
2. Реализовать создание крипто-депозита.
3. Реализовать IPN webhook endpoint.
4. Реализовать верификацию HMAC подписи.
5. Реализовать обработку статусов (waiting → confirming → finished).
6. Реализовать зачисление фактически полученной суммы.
7. Реализовать получение и кеширование курсов.

**Критерий приёмки:**

- создание крипто-депозита возвращает адрес и сумму;
- IPN callback корректно зачисляет средства;
- зачисляется `actually_paid`, не requested amount;
- курсы обновляются каждые 5 минут;
- expired платежи корректно обрабатываются.

---

### Блок D. Withdrawals

**Задачи:**

1. Реализовать создание заявки на фиатный вывод.
2. Реализовать создание заявки на крипто-вывод.
3. Реализовать блокировку средств при создании заявки.
4. Реализовать отмену заявки пользователем.
5. Реализовать admin approve.
6. Реализовать admin reject.
7. Реализовать KYC enforcement для выводов.
8. Реализовать базовую валидацию wallet addresses.
9. Реализовать маскирование карт в API ответах.

**Критерий приёмки:**

- заявка создаётся, средства блокируются;
- баланс отражает locked средства;
- отмена разблокирует средства;
- admin approve списывает заблокированные средства;
- admin reject разблокирует средства;
- без KYC — вывод невозможен;
- все admin действия в `audit_log`.

---

### Блок E. Admin финансовые операции

**Задачи:**

1. Реализовать ручное зачисление баланса (superadmin).
2. Реализовать ручное списание баланса (superadmin).
3. Реализовать список транзакций в админке.
4. Реализовать список `payment_requests` в админке.
5. Реализовать детали `payment_request` с raw callbacks.
6. Все admin операции с обязательным `audit_log`.

**Критерий приёмки:**

- superadmin может зачислить/списать с любого кошелька;
- все операции залогированы в `audit_log` с `reason`;
- транзакции видны с фильтрами.

---

### Блок F. Scheduled Jobs

**Задачи:**

1. Настроить BullMQ с Redis.
2. Реализовать expire pending payments job.
3. Реализовать exchange rate updater job.
4. Реализовать pending withdrawal reminder job.

**Критерий приёмки:**

- pending депозиты старше 2 часов автоматически expire;
- курсы обновляются каждые 5 минут;
- admin получает уведомление о зависших заявках.

---

## 15. Приёмка кассы: первые 90 секунд

> Продуктовый путь: [USER_FLOW_FIRST_90_SECONDS.md](USER_FLOW_FIRST_90_SECONDS.md).  
> Бэкенд обязан отдавать данные так, чтобы фронт **не показывал** выбор страны, 5 валют и чужие методы на пустом балансе.

### 15.1. Контракт `GET /api/v1/geo/config`

**Без auth** (гость) и **с auth** (свой игрок):

| Поле | Правило |
|---|---|
| `defaultCurrency` | По IP / hostname; MVP для RU → `RUB` |
| `enabledFiat` | Только валюты с живым PSP; MVP → `["RUB"]` |
| `enabledCrypto` | `["USDT_TRC20", "BTC"]` — не на первом экране, только «Ещё способы» |
| `paymentMethods` | Отфильтрованы по `legalCountry` + `defaultCurrency`; RU ≠ UA в одном ответе |
| `depositPresets` | Массив сумм **в валюте ответа** (см. tz-part-5 §2.5) |
| `depositMin` / `depositMax` | С символом валюты в metadata для UI |

Для залогиненного: если `currency_preference` задан — методы и пресеты **этой** валюты, даже в роуминге.

### 15.2. Контракт депозита (новичок, 0:35)

`POST /api/v1/payments/deposit/fiat`:

```json
{
  "amount": "2000.00",
  "currency": "RUB",
  "method": "sbp"
}
```

**Обязательно:**

- `currency` обязателен; без него — 400;
- `method` должен быть в списке geo для этой валюты; иначе `PAYMENT_METHOD_UNAVAILABLE`;
- ответ содержит `payment_url` ≤ 3 сек (timeout Rukassa 30 сек, но UX ждёт быстрее);
- после webhook: wallet credit в **той же** `currency`, не RUB-эквивалент на баланс;
- `last_payment_method` обновляется на профиле.

**Запрещено в MVP-flow:**

- возвращать методы всех стран в одном массиве;
- требовать выбор валюты, если активная одна;
- редиректить на `/wallet` вместо `payment_url`.

### 15.3. Контракт после оплаты

Polling `GET /api/v1/payments/deposit/:id/status` или push через refetch wallet:

- при `completed` — баланс в шапке уже в валюте депозита;
- `currency_preference` = валюта депозита (если первый депозит);
- фронт получает сигнал для кнопки «Вернуться в игру» (pending slug хранит UIStore, не API).

### 15.4. Крипто в том же flow (сценарий 5)

`POST /api/v1/payments/deposit/crypto`:

- только после явного выбора USDT/BTC на фронте;
- USDT: сеть TRC20 в ответе всегда;
- зачисление `actually_paid`, не requested amount;
- BTC: без пресетов суммы на API.

### 15.5. Чеклист приёмки (backend E2E)

```text
[ ] Гость RU: geo → RUB, methods = СБП/Карта/P2P, presets 1000/2000/5000/10000
[ ] POST deposit RUB+sbp → payment_url < 3s
[ ] Webhook → balance RUB += amount, last_payment_method = sbp
[ ] KZ (Phase 2): geo без СБП, presets в ₸
[ ] UA: нет российских method id в ответе
[ ] USDT deposit → credit USDT_TRC20 wallet, not RUB
[ ] Ошибка метода → PAYMENT_METHOD_UNAVAILABLE, не 500
```

---

## 16. Что НЕ делать в Части 3

- полноценный обменник между валютами;
- показ игроку общего баланса в RUB/USD эквиваленте;
- автоконвертацию при депозите, выводе или запуске игры;
- TON / TRX / LTC / ETH / USDT_ERC20 в релизе;
- автоматический вывод крипты через NOWPayments API;
- интеграцию с другими платёжными системами кроме Rukassa и NOWPayments (на MVP);
- бонусную логику;
- шифрование destination данных;
- комиссии.

---
