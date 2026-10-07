---
title: API Conventions
description: Все правила REST API casino-platform: URL, request/response, ошибки, пагинация
status: living document
last_updated: 2026-06-19
---

# API Conventions

> **Назначение:** Единые правила для всех REST endpoints. Соблюдение обязательно для всех модулей.

---

## 1. URL Structure

### 1.1. Версионирование

Все endpoints начинаются с `/api/v{N}/...`. Текущая версия — **v1**.

```
/api/v1/auth/register
/api/v1/wallet/balances
/api/v1/casino/games
/api/v1/admin/users
```

Breaking changes ⇒ новая версия (`/api/v2/...`).

### 1.2. Resource Naming

- **Plural nouns** для коллекций: `/users`, `/games`, `/tickets`
- **Singular** для singleton-операций: `/users/me`, `/wallet/balance`
- **Lowercase + kebab-case**: `/payment-requests`, `/game-sessions`
- **Не использовать** глаголы в URL. Если глагол нужен — это action endpoint:
  - `POST /payments/deposit`
  - `POST /auth/refresh`
  - `POST /users/me/avatar` (upload)

### 1.3. Action Endpoints

Когда операция не вписывается в CRUD:

```
POST /api/v1/auth/login              ← не GET (credentials в body)
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/payments/deposit
POST /api/v1/payments/withdraw
POST /api/v1/wallet/credit           ← admin only
POST /api/v1/wallet/debit            ← admin only
POST /api/v1/admin/users/:id/block
POST /api/v1/admin/users/:id/unblock
POST /api/v1/admin/kyc/:id/approve
POST /api/v1/admin/kyc/:id/reject
POST /api/v1/casino/games/:slug/launch
POST /api/v1/casino/games/:slug/favorite
```

### 1.4. Nested Resources

Не глубже **2 уровней**:

```
✅ POST /api/v1/support/tickets/:id/messages
✅ POST /api/v1/admin/withdrawals/:id/approve
❌ POST /api/v1/admin/users/:id/wallet/accounts/:accountId/credits/:creditId
```

Для сложных случаев использовать query-параметры или отдельный endpoint.

### 1.5. Public vs Private Routes

```
Public:
  GET   /api/v1/casino/games
  GET   /api/v1/casino/games/:slug
  POST  /api/v1/auth/register
  POST  /api/v1/auth/login
  POST  /api/v1/auth/refresh

Private (Authorization: Bearer ...):
  POST  /api/v1/wallet/deposit
  POST  /api/v1/casino/games/:slug/launch
  GET   /api/v1/users/me

Admin (Authorization: Bearer + role=admin):
  GET   /api/v1/admin/users
  POST  /api/v1/admin/users/:id/block

Internal (X-Internal-Token header):
  POST  /api/v1/provider-callback/...
  POST  /api/v1/payments/webhooks/...
```

---

## 2. Request Format

### 2.1. Headers

```
Content-Type: application/json
Authorization: Bearer <jwt_token>
X-Request-ID: <uuid>            // для трассировки
Accept-Language: ru             // для будущего i18n
```

### 2.2. Body

JSON, snake_case для совместимости с PostgreSQL:

```json
{
  "email": "user@example.com",
  "password": "secret_password",
  "first_name": "Иван"
}
```

camelCase только для устоявшихся полей (как `userId`, `idempotencyKey` — исторически сложилось).

**Машинная проверка.** Guard **G29** (`sh scripts/bin/tech-debt check dto-key-naming`, реестр —
`docs/QUALITY_GATES.md` §3.2) считает camelCase-ключи в `apps/api/src/modules/*/presentation/dto/*.ts`
и не даёт им расти: базлайн — 3 исторических ключа, новый = FAIL. Оговорка выше означает
«историческое не трогать», а не «можно писать новое»: имя ключа — часть контракта провода, и
расхождение с тем, что реально шлёт клиент, не видит ни `tsc`, ни ESLint, ни юнит-спек
(они передают объект напрямую, минуя HTTP). Три таких расхождения жили в партнёрке и стоили
PR #195, #197 и #198; самый тихий случай — `displayName`: ключ опциональный, поэтому сервер
отвечал 200 и не менял ничего.

### 2.3. Query Parameters

kebab-case для multi-word:

```
GET /api/v1/casino/games?category=slots&provider-id=pragmatic-play&sort=popular&page=1&per-page=24
```

### 2.4. Idempotency Key

**Все мутирующие endpoints требуют `Idempotency-Key`**:

```
POST /api/v1/payments/deposit
Headers:
  Idempotency-Key: dep_abc123_unique
```

Ключ уникален в рамках пользователя. Дубликаты → возврат результата первой операции.

Конвенции ключей:

| Операция        | Формат                                   |
| --------------- | ---------------------------------------- |
| Deposit         | `dep_{payment_request_id}`               |
| Withdraw        | `wd_{withdrawal_request_id}`             |
| Bet             | `bet_{transaction_id}`                   |
| Win             | `win_{round_id}_{index}`                 |
| Rollback        | `rb_{original_transaction_id}`           |
| Referral reward | `ref_{referrer_id}_{referred_id}_{date}` |

---

## 3. Response Format

### 3.1. Success Response

**Всегда:**

```json
{
  "success": true,
  "data": { ... },
  "meta": { ... }    // опционально
}
```

### 3.2. Error Response

**Всегда:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "email": ["Invalid email format"]
    },
    "requestId": "req_abc123"
  }
}
```

### 3.3. Meta для пагинации

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "page": 1,
    "perPage": 24,
    "total": 1523,
    "totalPages": 64,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### 3.4. Запрещено

- ❌ Возвращать объект без обёртки `{success, data}`
- ❌ Возвращать stack trace в production
- ❌ Возвращать `{error: "..."}` напрямую
- ❌ Возвращать `null` без причины

---

## 4. HTTP Status Codes

### 4.1. Success

| Code             | Когда                   |
| ---------------- | ----------------------- |
| `200 OK`         | GET, PUT, PATCH — успех |
| `201 Created`    | POST создание ресурса   |
| `202 Accepted`   | Async job queued        |
| `204 No Content` | DELETE (без body)       |

### 4.2. Client Errors (4xx)

| Code                       | Когда                                   |
| -------------------------- | --------------------------------------- |
| `400 Bad Request`          | Validation error, invalid syntax        |
| `401 Unauthorized`         | Missing/invalid JWT                     |
| `403 Forbidden`            | Insufficient permissions                |
| `404 Not Found`            | Resource doesn't exist                  |
| `409 Conflict`             | Duplicate request, constraint violation |
| `422 Unprocessable Entity` | Business rule violation (KYC_REQUIRED)  |
| `429 Too Many Requests`    | Rate limit exceeded                     |

### 4.3. Server Errors (5xx)

| Code                        | Когда                                 |
| --------------------------- | ------------------------------------- |
| `500 Internal Server Error` | Unhandled exception                   |
| `502 Bad Gateway`           | External service error (Rukassa down) |
| `503 Service Unavailable`   | Planned maintenance                   |
| `504 Gateway Timeout`       | External service timeout              |

---

## 5. Error Codes (Application)

### 5.1. Validation & Auth

```
VALIDATION_ERROR              400   Validation failed
UNAUTHORIZED                  401   Missing or invalid auth
INVALID_CREDENTIALS           401   Wrong email/password
EMAIL_NOT_VERIFIED            403   Email verification required
TOKEN_EXPIRED                 401   JWT expired
TOKEN_INVALID                 401   JWT malformed/invalid signature
SESSION_EXPIRED               401   Refresh token expired
ACCOUNT_BLOCKED               403   User blocked by admin
INSUFFICIENT_PERMISSIONS      403   Wrong role
```

### 5.2. Resources

```
NOT_FOUND                     404   Resource doesn't exist
ALREADY_EXISTS                409   Duplicate (e.g., email taken)
CONFLICT                      409   State conflict (e.g., already verified)
```

### 5.3. Business Rules

```
KYC_REQUIRED                  422   Вывод сверх порога без верификации (KYC_WITHDRAW_LIMIT_RUB)
KYC_PENDING                   422   KYC under review
WITHDRAW_LIMIT_EXCEEDED       422   Daily/monthly limit reached
```

> `WITHDRAW_LIMIT_EXCEEDED` в коде **не существует** (проверено по `rg` по
> `apps/api/src`): суточного и месячного лимита вывода в проекте нет ни в конфиге,
> ни в `system_settings`. Строка осталась в реестре с времён ТЗ и вводит в
> заблуждение ровно в одну сторону — читатель ждёт отказа «500 000 ₽ в сутки»,
> которого сервер не делает. Удалить её или реализовать — решение владельца по
> числу лимита, а не техника; до решения код не отдаём.

> Код `DEPOSIT_LIMIT_EXCEEDED` (422, «суммарные пополнения без KYC выше
> `KYC_DEPOSIT_LIMIT_RUB`) выведен из обращения 2026-10-07: верификация требуется
> на вывод, а не на пополнение, и отказывать может только вывод (`KYC_REQUIRED`).
> Класс ошибки удалён, чтобы контракт не обещал код, который сервер уже не отдаёт.
> `docs/LEGAL_COMPLIANCE.md` и `docs/QA_CHECKLIST.md` обновлены в том же PR.
> INSUFFICIENT_FUNDS 422 Wallet balance insufficient
> GAME_SESSION_INVALID 422 Session expired/unknown
> PROVIDER_MAINTENANCE 422 Provider offline
> GAME_NOT_FOUND 404 Game slug doesn't exist

```

### 5.4. Payment Specific

```

PAYMENT_PROVIDER_ERROR 502 Rukassa/NOWPayments down
INVALID_SIGNATURE 400 Webhook signature invalid
PAYMENT_EXPIRED 410 Invoice expired (>30 min)
DUPLICATE_REQUEST 409 Idempotency key conflict
AMOUNT_TOO_SMALL 422 Ниже минимума (на пополнении — минимум провайдера)
AMOUNT_TOO_LARGE 422 Выше максимума (только вывод: у пополнения верха нет)
INVALID_CURRENCY 422 Currency not supported

```

### 5.5. Rate Limit

```

RATE_LIMITED 429 Too many requests

```

### 5.6. Affiliate (партнёрская программа, ТЗ ч.8 §10.4)

```

AFFILIATE_NOT_FOUND 404 Партнёр не найден (по id или tracking_code)
AFFILIATE_NOT_ACTIVE 403 Партнёр suspended/rejected: клик не атрибутируется
AFFILIATE_CODE_INVALID 400 Некорректный код в трекинг-ссылке
AFFILIATE_ALREADY_EXISTS 409 Email уже зарегистрирован в программе
AFFILIATE_CREDENTIALS_INVALID 401 Неверный email/пароль партнёра
AFFILIATE_ALREADY_ATTRIBUTED 409 Игрок уже привязан к другому партнёру
AFFILIATE_SELF_REFERRAL 422 Обнаружено самопривлечение (F1/F2)
AFFILIATE_RATE_OUT_OF_RANGE 422 Ставка RevShare вне [0, 1]
AFFILIATE_SETTINGS_INVALID 422 Некорректное значение настройки программы
AFFILIATE_FRAUD_SUSPECTED 422 Фрод-скор выше порога (F3, ip_flood)
AFFILIATE_CLAWBACK_NOT_ALLOWED 422 Отмена начисления вне допустимого статуса

```

### 5.7. Internal

```

INTERNAL_ERROR 500 Generic server error
DATABASE_ERROR 500 Prisma error
EXTERNAL_SERVICE_ERROR 502 Failed external call
NOT_IMPLEMENTED 501 Feature not ready

```

### 5.8. Расширение error codes

Добавлять новые коды только если **ни один существующий не подходит**. Код должен быть:

- **UPPERCASE_SNAKE_CASE**
- **Семантически точный** (не `ERROR_1`, а `EMAIL_ALREADY_EXISTS`)
- **Стабильный** (не менять после публикации в API)

---

## 6. Pagination

### 6.1. Стратегия: Offset-based (для MVP)

```

GET /api/v1/casino/games?page=1&per-page=24
GET /api/v1/admin/users?page=1&per-page=50

```

### 6.2. Параметры

| Param      | Default | Max |
| ---------- | ------- | --- |
| `page`     | 1       | —   |
| `per-page` | 20      | 100 |

### 6.3. Cursor-based для больших списков (опционально)

Для transactions, ledger_entries — cursor-based:

```

GET /api/v1/wallet/transactions?cursor=2024-01-15T00:00:00Z&limit=50

```

Курсор = base64 от `{timestamp, id}`.

### 6.4. Бесконечная прокрутка

Frontend (apps/web) для game catalog — Intersection Observer + auto-load page N+1.

---

## 7. Filtering & Sorting

### 7.1. Filters

```

GET /api/v1/admin/users
?status=active
&kyc-status=approved
&has-balance=true
&registered-from=2024-01-01
&registered-to=2024-12-31

```

### 7.2. Sorting

```

GET /api/v1/admin/users?sort=created-at&order=desc
GET /api/v1/admin/users?sort=balance&order=desc

```

- `sort` — поле
- `order` — `asc` или `desc`

Запрещено сортировать по чувствительным полям (пароли, документы).

### 7.3. Search

```

GET /api/v1/admin/users?search=ivan@example.com

```

Search работает по `ILIKE` для PostgreSQL на определённых полях (email, username).

---

## 8. Rate Limiting

### 8.1. Default limits

| Endpoint group             | Limit                |
| -------------------------- | -------------------- |
| **General API**            | 60 req/min/IP        |
| **Auth (login, register)** | 10 req/min/IP        |
| **Withdrawals**            | 5 req/min/user       |
| **Webhooks**               | 100 req/min/provider |

### 8.2. Response при превышении

```

HTTP 429 Too Many Requests
Retry-After: 30

{
"success": false,
"error": {
"code": "RATE_LIMITED",
"message": "Too many requests. Try again in 30 seconds."
}
}

````

---

## 9. Timestamps

Все timestamps в **ISO 8601 UTC**:

```json
"createdAt": "2024-01-15T15:30:42.123Z"
"expiresAt": "2024-01-15T16:30:42.000Z"
````

**Не использовать:**

- Unix timestamp (плохо для отладки)
- Локальное время (timezone баги)
- Без timezone (неоднозначность)

---

## 10. Money в API

### 10.1. Все суммы — STRING

```json
{
  "amount": "1500.00",
  "amount": "0.00010000", // для crypto
  "currency": "RUB"
}
```

### 10.2. Никогда — number/float

```json
❌ "amount": 1500.00          // теряет точность
❌ "amount": 1500             // не указаны копейки
✅ "amount": "1500.00"
✅ "amount": "1500.00000000" // для crypto
```

### 10.3. Currency codes

Использовать `UPPERCASE_UNDERSCORE`:

```
RUB            фиат
USDT_TRC20     крипто
BTC            крипто
TON            крипто
TRX            крипто
LTC            крипто
```

---

## 11. ID Conventions

### 11.1. UUID v4 для всех entity IDs

```
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 11.2. Не использовать INT/SERIAL

- Сложно мигрировать между средами
- Угадываются (security)
- Auto-increment pitfalls

### 11.3. Short IDs (опционально для UI)

В местах где длинные UUID неудобны (URL, поддержка) — short ID:

```
public_id: "usr_a1b2c3d4"   // first 8 chars of UUID
```

`short_id` генерируется отдельно, не выводится.

---

## 12. Локализация

**MVP:** только русский.

Все сообщения ошибок — на русском:

```json
{
  "code": "EMAIL_ALREADY_EXISTS",
  "message": "Пользователь с таким email уже зарегистрирован"
}
```

В будущем — i18n через `t(key, locale)`:

```json
{
  "code": "EMAIL_ALREADY_EXISTS",
  "message": "Email already registered",
  "i18nKey": "errors.email_already_exists"
}
```

---

> **Контроль качества:** каждый новый endpoint проверяется по этому чеклисту:
>
> - [ ] URL соответствует naming conventions
> - [ ] Status code корректен
> - [ ] Response в формате `{success, data|error}`
> - [ ] Error code из списка
> - [ ] Idempotency key для мутаций
> - [ ] Все суммы — string
> - [ ] Timestamps в ISO 8601
