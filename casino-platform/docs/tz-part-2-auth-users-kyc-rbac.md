# ТЗ — Часть 2. Backend Core: Auth, Users, KYC, RBAC

> Вторая часть ТЗ casino-платформы. Описывает полную реализацию регистрации/входа, OAuth, Telegram Login, JWT-сессий, профиля пользователя, RBAC и KYC по лимитам.
>
> Всего ТЗ разбито на **7 частей**:
>
> 1. **Общая архитектура и foundation**
> 2. **Backend Core: Auth, Users, KYC, RBAC** ← текущая часть
> 3. **Wallet, Fiat/Crypto Payments, Transaction Ledger**
> 4. **Casino Providers и Game Session Layer**
> 5. **Frontend Web: витрина, личный кабинет, кошелёк, история**
> 6. **Admin Panel, Support, Referral System**
> 7. **DevOps, Security, Logging, QA, Release Prep**
>
> Файлы: [tz-part-1-foundation.md](tz-part-1-foundation.md) · **tz-part-2-auth-users-kyc-rbac.md**

---

## Содержание

1. [Цель этапа](#1-цель-этапа)
2. [Домен Auth](#2-домен-auth)
3. [Домен Users](#3-домен-users)
4. [Домен KYC](#4-домен-kyc)
5. [Домен RBAC](#5-домен-rbac-роли-и-права)
6. [Email-уведомления](#6-email-уведомления)
7. [Защита и безопасность этого домена](#7-защита-и-безопасность-этого-домена)
8. [Технические задачи Части 2](#8-технические-задачи-части-2)
9. [Что не делается в Части 2](#9-что-не-делается-в-части-2)

---

## 1. Цель этапа

Эта часть описывает полную реализацию:

- регистрации и входа пользователей;
- OAuth через Google;
- Telegram login;
- управления сессиями через JWT;
- профиля пользователя;
- системы ролей и прав доступа;
- KYC по лимитам.

Это второй фундаментальный блок, без которого невозможно двигаться дальше к кошельку, платежам и провайдерам.

---

## 2. Домен Auth

### 2.1. Общая логика

Система должна поддерживать три способа входа:

- email + пароль
- Google OAuth
- Telegram Login Widget

Все три способа должны приводить к единому результату:

- создание или нахождение пользователя в системе;
- выдача access token + refresh token;
- запись сессии.

### 2.2. Сущности базы данных

#### Таблица `users`

```
id                  UUID, PK, default gen_random_uuid()
email               VARCHAR(255), UNIQUE, nullable
email_verified      BOOLEAN, default false
username            VARCHAR(64), UNIQUE, nullable
password_hash       TEXT, nullable
status              ENUM(active, blocked, suspended), default active
role                ENUM(user, admin, superadmin), default user
referral_code       VARCHAR(32), UNIQUE, not null
referred_by         UUID, nullable, FK -> users.id
created_at          TIMESTAMPTZ, default now()
updated_at          TIMESTAMPTZ, default now()
last_login_at       TIMESTAMPTZ, nullable
```

#### Таблица `auth_providers`

Нужна чтобы пользователь мог привязать несколько способов входа.

```
id                  UUID, PK
user_id             UUID, FK -> users.id
provider            ENUM(email, google, telegram)
provider_user_id    TEXT, nullable (google sub / telegram id)
provider_email      TEXT, nullable
provider_data       JSONB, nullable (raw provider profile)
created_at          TIMESTAMPTZ, default now()

UNIQUE(provider, provider_user_id)
```

#### Таблица `sessions`

```
id                  UUID, PK
user_id             UUID, FK -> users.id
refresh_token_hash  TEXT, not null
ip_address          VARCHAR(64)
user_agent          TEXT
device_info         JSONB, nullable
expires_at          TIMESTAMPTZ
created_at          TIMESTAMPTZ
revoked_at          TIMESTAMPTZ, nullable
```

#### Таблица `email_verifications`

```
id                  UUID, PK
user_id             UUID, FK -> users.id
token               VARCHAR(128), UNIQUE
expires_at          TIMESTAMPTZ
used_at             TIMESTAMPTZ, nullable
created_at          TIMESTAMPTZ
```

#### Таблица `password_resets`

```
id                  UUID, PK
user_id             UUID, FK -> users.id
token               VARCHAR(128), UNIQUE
expires_at          TIMESTAMPTZ
used_at             TIMESTAMPTZ, nullable
created_at          TIMESTAMPTZ
```

### 2.3. Auth Module — Use Cases

#### UC-AUTH-01: Регистрация через email

**Входные данные:**

```json
{
  "email": "user@example.com",
  "password": "strongpassword",
  "referral_code": "optional"
}
```

**Правила:**

- email нормализовать: lowercase, trim;
- проверить уникальность email;
- пароль минимум 8 символов;
- хешировать через argon2id;
- создать запись `users`;
- создать запись `auth_providers` с provider = email;
- сгенерировать уникальный `referral_code` для нового пользователя;
- если передан `referral_code` — найти referrer и сохранить `referred_by`;
- отправить email с подтверждением (через очередь BullMQ);
- **НЕ выдавать токены** пока email не подтверждён;
- возвращать только `{ message: "Confirm your email" }`.

**Ошибки:**

- `EMAIL_ALREADY_EXISTS`
- `INVALID_EMAIL`
- `WEAK_PASSWORD`
- `REFERRAL_CODE_NOT_FOUND`

---

#### UC-AUTH-02: Подтверждение email

**Endpoint:** `GET /api/v1/auth/verify-email?token=...`

**Правила:**

- найти token в `email_verifications`;
- проверить `expires_at` (срок жизни 24 часа);
- проверить `used_at` (не использован);
- поставить `email_verified = true` у пользователя;
- поставить `used_at` на текущее время;
- выдать access + refresh token;
- создать сессию.

**Ошибки:**

- `TOKEN_INVALID`
- `TOKEN_EXPIRED`
- `TOKEN_ALREADY_USED`

---

#### UC-AUTH-03: Вход через email

**Входные данные:**

```json
{
  "email": "user@example.com",
  "password": "password"
}
```

**Правила:**

- найти пользователя по email;
- проверить что email подтверждён;
- проверить что пользователь не заблокирован;
- проверить пароль через `argon2.verify`;
- обновить `last_login_at`;
- создать новую сессию в `sessions`;
- вернуть access token + refresh token;
- refresh token передавать в httpOnly cookie;
- access token передавать в теле ответа.

**Ошибки:**

- `INVALID_CREDENTIALS`
- `EMAIL_NOT_VERIFIED`
- `ACCOUNT_BLOCKED`

---

#### UC-AUTH-04: Refresh token

**Входные данные:** refresh token из httpOnly cookie.

**Правила:**

- найти сессию по hash refresh token;
- проверить `expires_at`;
- проверить что не отозвана;
- проверить статус пользователя;
- выдать новый access token;
- ротация refresh token — каждый раз выдавать новый;
- старый refresh token инвалидировать;
- обновить запись сессии.

**Ошибки:**

- `SESSION_INVALID`
- `SESSION_EXPIRED`
- `ACCOUNT_BLOCKED`

---

#### UC-AUTH-05: Logout

**Правила:**

- получить текущую сессию из токена;
- поставить `revoked_at` у текущей сессии;
- очистить cookie.

---

#### UC-AUTH-06: Forgot Password

**Входные данные:**

```json
{ "email": "user@example.com" }
```

**Правила:**

- найти пользователя;
- если не найден — всё равно вернуть `{ message: "If email exists, you will receive a link" }`;
- это нужно чтобы не раскрывать наличие email;
- создать запись в `password_resets` со сроком жизни 1 час;
- отправить email через BullMQ;
- старые неиспользованные токены не удалять, но они уже невалидны по `expires_at`.

---

#### UC-AUTH-07: Reset Password

**Входные данные:**

```json
{
  "token": "...",
  "new_password": "..."
}
```

**Правила:**

- найти token в `password_resets`;
- проверить `expires_at`;
- проверить `used_at`;
- хешировать новый пароль;
- обновить `password_hash` у пользователя;
- поставить `used_at`;
- инвалидировать все сессии пользователя (`revoked_at = now()`);
- не выдавать токен — пользователь должен заново войти.

---

#### UC-AUTH-08: Google OAuth

**Флоу:**

```
1. Frontend открывает Google OAuth URL
2. Google редиректит на /api/v1/auth/google/callback с code
3. Backend меняет code на google profile
4. Ищем auth_providers запись с provider=google, provider_user_id=google_sub
5. Если нашли — входим как существующий пользователь
6. Если не нашли:
   a. Ищем users по email из Google profile
   b. Если нашли — привязываем Google к существующему аккаунту
   c. Если не нашли — создаём нового пользователя
7. Создаём сессию, выдаём токены
8. Редиректим на frontend с токеном в параметре или cookie
```

**Правила:**

- если пользователь создаётся через Google — email сразу считается подтверждённым;
- `password_hash` = null для таких пользователей;
- сохранять `provider_data` с raw profile для логов;
- сохранять Google email в `provider_email`.

---

#### UC-AUTH-09: Telegram Login

Telegram предоставляет виджет на frontend. После клика на «Login with Telegram» Telegram возвращает данные пользователя.

**Флоу:**

```
1. На frontend встроен Telegram Login Widget
2. Telegram отдаёт объект с полями:
   id, first_name, last_name, username, photo_url, auth_date, hash
3. Frontend отправляет эти данные на backend
4. Backend проверяет hash через HMAC-SHA256 с Telegram Bot Token
5. Проверяет auth_date (не старше 5 минут)
6. Ищем auth_providers с provider=telegram, provider_user_id=telegram_id
7. Логика создания/входа — аналогично Google
```

**Правила:**

- верификация hash обязательна, иначе это security hole;
- у telegram пользователя нет email — поле `email` может быть null;
- username в Telegram сохранить в `provider_data`;
- `email_verified = true` не ставим (email нет), но в целом для входа верификация email не требуется.

---

### 2.4. JWT Token Model

#### Access Token

- тип: Bearer JWT
- срок жизни: 15 минут
- payload:

```json
{
  "sub": "user-uuid",
  "role": "user",
  "session_id": "session-uuid",
  "iat": 0,
  "exp": 0
}
```

#### Refresh Token

- хранится: httpOnly, Secure, SameSite=Strict cookie
- срок жизни: 30 дней
- в БД хранить только hash (SHA-256)
- при каждом использовании — ротация

### 2.5. Guards и Middleware

#### Auth Guard

- проверяет access token;
- кладёт `user` объект в request context;
- используется на всех protected endpoints.

#### Roles Guard

- проверяет роль пользователя;
- используется на admin-только endpoints.

#### Request ID Middleware

- генерирует UUID для каждого запроса;
- добавляет в headers `X-Request-Id`.

#### Rate Limit

Применять глобально, с отдельными настройками для:

- `/api/v1/auth/login` — 10 попыток в 15 минут;
- `/api/v1/auth/register` — 5 в час;
- `/api/v1/auth/forgot-password` — 3 в час;
- `/api/v1/auth/*` — 30 запросов в минуту в целом.

---

## 3. Домен Users

### 3.1. Сущности базы данных

#### Таблица `user_profiles`

```
id                  UUID, PK
user_id             UUID, FK -> users.id, UNIQUE
first_name          VARCHAR(128), nullable
last_name           VARCHAR(128), nullable
date_of_birth       DATE, nullable
phone               VARCHAR(32), nullable
phone_verified      BOOLEAN, default false
country             VARCHAR(2), nullable (ISO Alpha-2)
city                VARCHAR(128), nullable
avatar_url          TEXT, nullable
currency_preference VARCHAR(10), default 'RUB'
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

#### Таблица `user_settings`

```
id                  UUID, PK
user_id             UUID, FK -> users.id, UNIQUE
notifications_email BOOLEAN, default true
notifications_push  BOOLEAN, default true
two_fa_enabled      BOOLEAN, default false
two_fa_secret       TEXT, nullable
language            VARCHAR(8), default 'ru'
timezone            VARCHAR(64), default 'Europe/Moscow'
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

### 3.2. Users Module — Use Cases

#### UC-USER-01: Получить профиль текущего пользователя

```
GET /api/v1/users/me
Authorization: Bearer <token>
```

**Возвращает:**

- user базовые поля;
- user_profile;
- user_settings;
- kyc_status;
- referral_code;
- wallet balances.

---

#### UC-USER-02: Обновить профиль

```
PATCH /api/v1/users/me/profile
```

**Входные данные:**

```json
{
  "first_name": "Иван",
  "last_name": "Петров",
  "date_of_birth": "1990-05-15",
  "country": "RU",
  "city": "Москва"
}
```

**Правила:**

- дату рождения нельзя изменить если KYC пройден;
- страну нельзя изменить если KYC пройден;
- сохранить изменения в `user_profiles`.

---

#### UC-USER-03: Обновить настройки

```
PATCH /api/v1/users/me/settings
```

**Входные данные:**

```json
{
  "notifications_email": true,
  "notifications_push": false,
  "language": "ru",
  "timezone": "Europe/Moscow"
}
```

---

#### UC-USER-04: Загрузить аватар

```
POST /api/v1/users/me/avatar
Content-Type: multipart/form-data
```

**Правила:**

- принимать: jpg, png, webp;
- максимальный размер: 5MB;
- сохранять в файловое хранилище;
- записывать `avatar_url` в профиль;
- старый файл удалять.

> На MVP можно сохранять в папку на VPS с nginx static, потом переехать на S3-совместимое.

---

#### UC-USER-05: Получить список сессий

```
GET /api/v1/users/me/sessions
```

**Возвращает:**

- список активных сессий;
- для каждой: ip, user_agent, created_at, последнее использование;
- отметка текущей сессии.

---

#### UC-USER-06: Отозвать сессию

```
DELETE /api/v1/users/me/sessions/:session_id
```

**Правила:**

- нельзя отозвать текущую сессию через этот endpoint;
- для текущей — использовать logout.

---

## 4. Домен KYC

### 4.1. Концепция

KYC в этом проекте срабатывает **по лимитам**, а не обязательно при регистрации.

Лимит: **5000 рублей** суммарных пополнений.

Когда пользователь превышает этот порог — он должен пройти верификацию, иначе не может:

- делать дальнейшие пополнения;
- выводить средства.

### 4.2. Сущности базы данных

#### Таблица `kyc_profiles`

```
id                      UUID, PK
user_id                 UUID, FK -> users.id, UNIQUE
status                  ENUM(not_started, pending, approved, rejected, requires_resubmission)
first_name              VARCHAR(128), nullable
last_name               VARCHAR(128), nullable
date_of_birth           DATE, nullable
country                 VARCHAR(2), nullable
document_type           ENUM(passport, id_card, drivers_license), nullable
document_number         VARCHAR(64), nullable
document_expiry         DATE, nullable
rejection_reason        TEXT, nullable
approved_at             TIMESTAMPTZ, nullable
rejected_at             TIMESTAMPTZ, nullable
submitted_at            TIMESTAMPTZ, nullable
reviewed_by             UUID, nullable, FK -> admin_users.id
created_at              TIMESTAMPTZ
updated_at              TIMESTAMPTZ
```

#### Таблица `kyc_documents`

```
id                  UUID, PK
kyc_profile_id      UUID, FK -> kyc_profiles.id
document_type       ENUM(front, back, selfie, proof_of_address)
file_url            TEXT, not null
file_name           TEXT
file_size           INTEGER
mime_type           VARCHAR(64)
uploaded_at         TIMESTAMPTZ
```

### 4.3. KYC Module — Use Cases

#### UC-KYC-01: Проверить нужен ли KYC

Эта проверка должна вызываться автоматически при каждом запросе пополнения.

**Логика:**

```
Считаем total_deposited = сумма всех completed депозитов пользователя в RUB эквиваленте
Если total_deposited >= 5000 RUB И kyc_status != approved:
  → блокировать пополнение
  → вернуть ошибку KYC_REQUIRED
```

Конвертацию крипты в рубли считать по курсу на момент депозита, хранить сохранённый RUB-эквивалент в транзакции.

---

#### UC-KYC-02: Начать KYC / подать заявку

```
POST /api/v1/kyc/submit
```

**Входные данные:**

```json
{
  "first_name": "Иван",
  "last_name": "Петров",
  "date_of_birth": "1990-05-15",
  "country": "RU",
  "document_type": "passport",
  "document_number": "1234 567890",
  "document_expiry": "2030-01-01"
}
```

**Правила:**

- создать или обновить `kyc_profiles`;
- статус перевести в `pending`;
- уведомить администраторов (через BullMQ → notification);
- пользователь должен отдельно загрузить документы.

---

#### UC-KYC-03: Загрузить документы

```
POST /api/v1/kyc/documents
Content-Type: multipart/form-data
```

**Входные данные:**

- `document_type`: `front` | `back` | `selfie` | `proof_of_address`
- `file`: файл

**Правила:**

- принимать: jpg, png, pdf;
- максимальный размер: 10MB;
- сохранять в закрытую директорию (не публичный URL);
- записывать в `kyc_documents`;
- KYC profile должен быть в статусе `pending` или `requires_resubmission`.

---

#### UC-KYC-04: Получить статус KYC

```
GET /api/v1/kyc/status
```

**Возвращает:**

```json
{
  "status": "pending",
  "submitted_at": "2024-01-01T00:00:00Z",
  "rejection_reason": null,
  "documents": ["front", "selfie"]
}
```

---

#### UC-KYC-05: Одобрить KYC (Admin)

```
POST /api/v1/admin/kyc/:kyc_profile_id/approve
```

**Правила:**

- доступно только admin/superadmin;
- перевести статус в `approved`;
- записать `approved_at` и `reviewed_by`;
- уведомить пользователя (через BullMQ → notification);
- разблокировать возможность пополнений.

---

#### UC-KYC-06: Отклонить KYC (Admin)

```
POST /api/v1/admin/kyc/:kyc_profile_id/reject
```

**Входные данные:**

```json
{
  "reason": "Документ нечёткий, загрузите заново"
}
```

**Правила:**

- перевести статус в `rejected`;
- сохранить `rejection_reason`;
- уведомить пользователя.

---

#### UC-KYC-07: Запросить повторную отправку (Admin)

```
POST /api/v1/admin/kyc/:kyc_profile_id/request-resubmission
```

**Входные данные:**

```json
{
  "reason": "Нужен документ с другой стороны"
}
```

**Правила:**

- перевести статус в `requires_resubmission`;
- уведомить пользователя;
- пользователь может загрузить документы заново.

---

## 5. Домен RBAC (Роли и права)

### 5.1. Концепция

На MVP не нужна сложная динамическая RBAC система.

Достаточно фиксированных ролей с чёткими зонами ответственности.

### 5.2. Роли

#### Для пользователей

```
user — стандартный пользователь казино
```

#### Для администрации

```
admin       — менеджер: KYC, support, users view
superadmin  — полный доступ
```

### 5.3. Права по ролям

#### `user`

- доступ к своему профилю;
- доступ к своему кошельку;
- доступ к игровым сессиям;
- доступ к поддержке;
- доступ к реферальному кабинету.

#### `admin`

- просмотр пользователей;
- KYC review (approve/reject);
- просмотр транзакций;
- управление тикетами поддержки;
- просмотр audit logs;
- просмотр referrals.

#### `superadmin`

- всё что admin;
- управление провайдерами (вкл/выкл);
- управление лимитами KYC;
- управление другими admin-пользователями;
- ручная корректировка баланса с обязательным audit log;
- просмотр и экспорт финансовых отчётов.

### 5.4. Сущности базы данных для Admin

#### Таблица `admin_users`

```
id              UUID, PK
email           VARCHAR(255), UNIQUE
password_hash   TEXT
role            ENUM(admin, superadmin)
first_name      VARCHAR(128)
last_name       VARCHAR(128)
is_active       BOOLEAN, default true
created_by      UUID, nullable, FK -> admin_users.id
last_login_at   TIMESTAMPTZ, nullable
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

#### Таблица `audit_logs`

```
id              UUID, PK
actor_type      ENUM(user, admin, system)
actor_id        UUID
action          VARCHAR(128)
target_type     VARCHAR(64), nullable
target_id       UUID, nullable
payload         JSONB, nullable
ip_address      VARCHAR(64), nullable
user_agent      TEXT, nullable
created_at      TIMESTAMPTZ
```

**Примеры action:**

```
admin.kyc.approved
admin.kyc.rejected
admin.user.blocked
admin.balance.adjusted
admin.admin_created
user.login
user.logout
user.password_changed
user.kyc.submitted
payment.deposit.created
payment.withdrawal.created
```

### 5.5. Audit Log Use Cases

#### UC-AUDIT-01: Записать событие

Внутренний метод, вызываемый из других модулей.

```typescript
auditService.log({
  actorType: 'admin',
  actorId: adminId,
  action: 'admin.kyc.approved',
  targetType: 'kyc_profile',
  targetId: kycProfileId,
  payload: { reason: '...' },
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
})
```

**Правила:**

- запись в `audit_logs` обязательна для:
  - всех admin действий;
  - изменения статуса KYC;
  - блокировки пользователей;
  - ручной корректировки баланса;
  - входа администратора.

---

#### UC-AUDIT-02: Получить audit log (Admin)

```
GET /api/v1/admin/audit-logs
```

**Параметры:**

- `actor_type`
- `actor_id`
- `action`
- `target_type`
- `target_id`
- `from`
- `to`
- `page`
- `per_page`

---

## 6. Email-уведомления

### 6.1. Какие письма нужны на MVP

- подтверждение email при регистрации;
- сброс пароля;
- KYC одобрен;
- KYC отклонён;
- KYC требует повторной отправки.

### 6.2. Как реализовать

- отправка через BullMQ queue;
- SMTP провайдер — Resend или SMTP сервер;
- простые HTML шаблоны;
- тема писем на русском языке.

---

## 7. Защита и безопасность этого домена

### 7.1. Пароли

- хешировать через **argon2id**;
- параметры: `memory cost 65536, time cost 3, parallelism 4`;
- никогда не логировать пароли даже в debug.

### 7.2. Токены

- JWT подписывать через RS256 или HS256 с длинным секретом;
- refresh token хранить только hash в БД;
- reset/verify токены генерировать через `crypto.randomBytes(64)`;
- все токены иметь короткий срок жизни.

### 7.3. Rate Limiting

- все auth endpoints защищены rate limit;
- повторные неудачные входы логировать;
- возможная блокировка IP после N неудачных попыток — опционально для MVP.

### 7.4. KYC документы

- файлы хранить в папке без публичного доступа;
- отдавать только через signed route с проверкой прав;
- админ видит документы только через `/api/v1/admin/kyc/:id/documents/:doc_id`.

---

## 8. Технические задачи Части 2

### Блок A. Auth Module

**Задачи:**

1. Создать `modules/auth`.
2. Реализовать регистрацию через email.
3. Реализовать верификацию email по токену.
4. Реализовать вход через email.
5. Реализовать refresh token endpoint.
6. Реализовать logout.
7. Реализовать forgot password.
8. Реализовать reset password.
9. Реализовать Google OAuth.
10. Реализовать Telegram Login verification.
11. Написать Auth Guard.
12. Написать Rate Limit guard для auth endpoints.

**Критерий приёмки:**

- регистрация создаёт пользователя и отправляет письмо в очередь;
- верификация email выдаёт токены;
- вход работает;
- неверный пароль возвращает `INVALID_CREDENTIALS`;
- refresh ротирует токен;
- logout инвалидирует сессию;
- Google OAuth корректно создаёт/находит пользователя;
- Telegram hash verification работает корректно;
- превышение rate limit возвращает 429.

---

### Блок B. Users Module

**Задачи:**

1. Создать `modules/users`.
2. Реализовать `GET /api/v1/users/me`.
3. Реализовать `PATCH /api/v1/users/me/profile`.
4. Реализовать `PATCH /api/v1/users/me/settings`.
5. Реализовать загрузку аватара.
6. Реализовать получение сессий.
7. Реализовать отзыв сессии.

**Критерий приёмки:**

- `/users/me` возвращает полный профиль с KYC статусом;
- профиль обновляется корректно;
- аватар сохраняется и URL обновляется;
- сессии видны и могут быть отозваны.

---

### Блок C. KYC Module

**Задачи:**

1. Создать `modules/kyc`.
2. Реализовать `POST /api/v1/kyc/submit`.
3. Реализовать `POST /api/v1/kyc/documents`.
4. Реализовать `GET /api/v1/kyc/status`.
5. Реализовать KYC check logic (по лимиту 5000 RUB).
6. Реализовать admin endpoints для review.
7. Реализовать отправку уведомлений при смене статуса.

**Критерий приёмки:**

- пользователь может подать KYC;
- загрузить документы;
- при депозите > 5000 RUB суммарно система возвращает `KYC_REQUIRED`;
- admin может одобрить/отклонить;
- при изменении статуса пользователь получает уведомление (в очередь).

---

### Блок D. Admin Module (Auth и Users часть)

**Задачи:**

1. Реализовать отдельный login для admin.
2. Реализовать Roles Guard.
3. Реализовать `GET /api/v1/admin/users` (список с фильтрами).
4. Реализовать `GET /api/v1/admin/users/:id` (полный профиль).
5. Реализовать `POST /api/v1/admin/users/:id/block`.
6. Реализовать `POST /api/v1/admin/users/:id/unblock`.
7. Реализовать `GET /api/v1/admin/kyc` (список заявок).
8. Реализовать `GET /api/v1/admin/kyc/:id`.
9. Реализовать KYC approve/reject/resubmission endpoints.
10. Реализовать Audit Log writer.
11. Реализовать `GET /api/v1/admin/audit-logs`.

**Критерий приёмки:**

- admin login работает отдельно от user login;
- роли защищают endpoints;
- admin может просматривать, блокировать пользователей;
- KYC review работает полностью;
- все admin actions записываются в `audit_logs`.

---

### Блок E. Email Queue

**Задачи:**

1. Создать BullMQ queue `email`.
2. Создать email worker.
3. Создать шаблоны для всех 5 видов писем.
4. Подключить SMTP.
5. Реализовать retry при ошибке (3 попытки).

**Критерий приёмки:**

- письмо подтверждения приходит при регистрации;
- письмо сброса пароля приходит;
- KYC письма уходят при смене статуса.

---

## 9. Что не делается в Части 2

- платёжная логика;
- кошелёк;
- провайдеры игр;
- реферальная система;
- тикеты поддержки;
- frontend страницы;
- admin panel UI.

---

_Если всё понятно — напиши **«продолжай»**, и я дам **Часть 3: Wallet, Fiat/Crypto Payments, Transaction Ledger**._
