# ТЗ — Часть 4. Casino Providers и Game Session Layer

> Четвёртая часть ТЗ casino-платформы. Описывает архитектуру интеграции с игровыми провайдерами через Seamless Wallet API, управление каталогом игр, запуск игровых сессий, обработку ставок/выигрышей и admin-управление провайдерами.
>
> Всего ТЗ разбито на **7 частей**:
>
> 1. **Общая архитектура и foundation** — [tz-part-1-foundation.md](tz-part-1-foundation.md)
> 2. **Backend Core: Auth, Users, KYC, RBAC** — [tz-part-2-auth-users-kyc-rbac.md](tz-part-2-auth-users-kyc-rbac.md)
> 3. **Wallet, Fiat/Crypto Payments, Transaction Ledger** — [tz-part-3-payments-wallet.md](tz-part-3-payments-wallet.md)
> 4. **Casino Providers и Game Session Layer** ← текущая часть
> 5. **Frontend Web: витрина, личный кабинет, кошелёк, история**
> 6. **Admin Panel, Support, Referral System**
> 7. **DevOps, Security, Logging, QA, Release Prep**

---

## Содержание

1. [Цель этапа](#1-цель-этапа)
2. [Архитектура интеграции](#2-архитектура-интеграции)
3. [Сущности базы данных](#3-сущности-базы-данных)
4. [Provider Adapter Layer](#4-provider-adapter-layer)
5. [Seamless Wallet API Endpoints](#5-seamless-wallet-api-endpoints)
6. [Запуск игр](#6-запуск-игр)
7. [Каталог игр](#7-каталог-игр)
8. [История игровых сессий](#8-история-игровых-сессий)
9. [Admin операции](#9-admin-операции)
10. [Session Management](#10-session-management)
11. [Обработка ошибок в callback-ах](#11-обработка-ошибок-в-callback-ах)
12. [Provider-specific Adapters](#12-provider-specific-adapters)
13. [Demo Provider для разработки](#13-demo-provider-для-разработки)
14. [Events](#14-events)
15. [Performance и Caching](#15-performance-и-caching)
16. [Технические задачи Части 4](#16-технические-задачи-части-4)
17. [Что НЕ делать в Части 4](#17-что-не-делать-в-части-4)

---

## 1. Цель этапа

Эта часть описывает:

- архитектуру интеграции с игровыми провайдерами;
- Seamless Wallet API (стандарт взаимодействия провайдеров с нашим кошельком);
- управление каталогом игр;
- запуск игровых сессий;
- обработку ставок и выигрышей от провайдеров;
- отображение и фильтрацию игр;
- admin-управление провайдерами и играми.

> На этом этапе пользователь сможет играть в реальные слоты, рулетку, live-казино через провайдеров.

---

## 2. Архитектура интеграции

### 2.1. Как работают игровые провайдеры

Провайдер (Pragmatic Play, Evolution и т.д.) предоставляет:

- каталог игр (список слотов, рулеток и т.д.);
- URL для запуска игры в iframe;
- Wallet API — набор HTTP endpoints, которые провайдер вызывает **на нашей стороне**.

> **Ключевой момент:** провайдер вызывает наш сервер, а не мы вызываем провайдера.

```
Пользователь                    Наш Backend              Провайдер
    │                               │                        │
    │  1. Нажимает "Играть"         │                        │
    │──────────────────────────────>│                        │
    │                               │  2. Создаём сессию     │
    │                               │  и получаем game URL   │
    │                               │───────────────────────>│
    │                               │<───────────────────────│
    │  3. Открываем iframe          │                        │
    │<──────────────────────────────│                        │
    │                               │                        │
    │  Пользователь делает ставку   │                        │
    │  в iframe провайдера          │                        │
    │                               │                        │
    │                               │  4. Провайдер вызывает │
    │                               │  наш Wallet API        │
    │                               │<───────────────────────│
    │                               │  - authenticate        │
    │                               │  - balance             │
    │                               │  - bet (debit)         │
    │                               │  - win (credit)        │
    │                               │  - rollback            │
    │                               │───────────────────────>│
    │                               │                        │
```

### 2.2. Seamless Wallet vs Transfer Wallet

**Seamless Wallet** — провайдер вызывает наш API при каждой ставке/выигрыше в реальном времени. Баланс всегда актуален. **Это предпочтительный подход.**

**Transfer Wallet** — мы переводим деньги на счёт провайдера, он ведёт свой баланс. Устаревший подход.

**Выбираем:** Seamless Wallet.

### 2.3. Общая модель интеграции

У каждого провайдера свой API формат, но суть одинакова:

```
authenticate  → проверить что игрок валиден, вернуть баланс
balance       → вернуть текущий баланс
bet           → списать сумму ставки
win           → зачислить выигрыш
rollback      → отменить ставку, вернуть деньги
```

Поэтому нужен **Provider Adapter Layer** — единый внутренний интерфейс, под который подстраивается каждый конкретный провайдер.

---

## 3. Сущности базы данных

### 3.1. Таблица `game_providers`

```
id                  UUID, PK
slug                VARCHAR(64), UNIQUE, not null
name                VARCHAR(128), not null
type                ENUM(slots, live_casino, table_games, other)
is_enabled          BOOLEAN, default true
api_url             TEXT, nullable
api_key             TEXT, nullable
api_secret          TEXT, nullable
config              JSONB, default '{}'
logo_url            TEXT, nullable
sort_order          INTEGER, default 0
game_count          INTEGER, default 0
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ

INDEX(slug)
INDEX(is_enabled)
INDEX(sort_order)
```

**Поле `config`** содержит провайдер-специфичные настройки:

```json
{
  "lobby_url": "https://...",
  "callback_auth_method": "hmac",
  "callback_secret": "...",
  "supported_currencies": ["RUB", "USD", "EUR"],
  "default_language": "ru",
  "ip_whitelist": ["1.2.3.4", "5.6.7.8"]
}
```

### 3.2. Таблица `games`

```
id                  UUID, PK
provider_id         UUID, FK -> game_providers.id
external_game_id    VARCHAR(255), not null
slug                VARCHAR(255), UNIQUE, not null
name                VARCHAR(255), not null
name_ru             VARCHAR(255), nullable
type                ENUM(slot, live_roulette, live_blackjack, live_baccarat,
                         live_poker, live_game_show, table_game,
                         crash, dice, other)
category            ENUM(slots, live_casino, table_games, instant_games, other)
subcategory         VARCHAR(64), nullable
thumbnail_url       TEXT, nullable
banner_url          TEXT, nullable
is_enabled          BOOLEAN, default true
is_featured         BOOLEAN, default false
is_new              BOOLEAN, default false
is_popular          BOOLEAN, default false
has_demo            BOOLEAN, default true
rtp                 DECIMAL(5,2), nullable
volatility          ENUM(low, medium, high, very_high), nullable
max_win_multiplier  DECIMAL(10,2), nullable
min_bet             DECIMAL(20,8), nullable
max_bet             DECIMAL(20,8), nullable
supported_currencies JSONB, default '[]'
tags                JSONB, default '[]'
sort_order          INTEGER, default 0
launch_count        INTEGER, default 0
metadata            JSONB, default '{}'
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ

UNIQUE(provider_id, external_game_id)
INDEX(provider_id)
INDEX(slug)
INDEX(category)
INDEX(type)
INDEX(is_enabled)
INDEX(is_featured)
INDEX(is_popular)
INDEX(is_new)
INDEX(sort_order)
INDEX(launch_count)
```

### 3.3. Таблица `game_sessions`

```
id                  UUID, PK
user_id             UUID, FK -> users.id
game_id             UUID, FK -> games.id
provider_id         UUID, FK -> game_providers.id
session_token       VARCHAR(255), UNIQUE, not null
currency            VARCHAR(16), not null
is_demo             BOOLEAN, default false
status              ENUM(active, closed, expired)
ip_address          VARCHAR(64)
user_agent          TEXT, nullable
started_at          TIMESTAMPTZ, default now()
last_activity_at    TIMESTAMPTZ, default now()
closed_at           TIMESTAMPTZ, nullable
total_bet           DECIMAL(20,8), default 0
total_win           DECIMAL(20,8), default 0
rounds_played       INTEGER, default 0
metadata            JSONB, default '{}'

INDEX(user_id)
INDEX(game_id)
INDEX(provider_id)
INDEX(session_token)
INDEX(status)
INDEX(started_at)
```

### 3.4. Таблица `game_rounds`

```
id                  UUID, PK
session_id          UUID, FK -> game_sessions.id
user_id             UUID, FK -> users.id
game_id             UUID, FK -> games.id
provider_id         UUID, FK -> game_providers.id
external_round_id   VARCHAR(255), not null
status              ENUM(open, closed, rolled_back)
currency            VARCHAR(16), not null
total_bet           DECIMAL(20,8), default 0
total_win           DECIMAL(20,8), default 0
created_at          TIMESTAMPTZ
closed_at           TIMESTAMPTZ, nullable

UNIQUE(provider_id, external_round_id)
INDEX(session_id)
INDEX(user_id)
INDEX(external_round_id)
INDEX(status)
```

### 3.5. Таблица `game_transactions`

Детальная запись каждой операции провайдера.

```
id                      UUID, PK
round_id                UUID, FK -> game_rounds.id
session_id              UUID, FK -> game_sessions.id
user_id                 UUID, FK -> users.id
provider_id             UUID, FK -> game_providers.id
type                    ENUM(bet, win, rollback)
external_transaction_id VARCHAR(255), not null
amount                  DECIMAL(20,8), not null
currency                VARCHAR(16), not null
balance_after           DECIMAL(20,8), not null
processed               BOOLEAN, default true
ledger_entry_id         UUID, nullable, FK -> ledger_entries.id
metadata                JSONB, default '{}'
created_at              TIMESTAMPTZ

UNIQUE(provider_id, external_transaction_id)
INDEX(round_id)
INDEX(session_id)
INDEX(user_id)
INDEX(external_transaction_id)
INDEX(type)
```

### 3.6. Таблица `game_favorites`

```
id          UUID, PK
user_id     UUID, FK -> users.id
game_id     UUID, FK -> games.id
created_at  TIMESTAMPTZ

UNIQUE(user_id, game_id)
INDEX(user_id)
```

---

## 4. Provider Adapter Layer

### 4.1. Единый внутренний интерфейс

Каждый конкретный провайдер должен реализовать следующий интерфейс:

```typescript
interface GameProviderAdapter {
  // Получить URL для запуска игры
  getLaunchUrl(params: {
    gameExternalId: string
    sessionToken: string
    playerToken: string
    currency: string
    language: string
    returnUrl: string
    isDemo: boolean
    isMobile: boolean
    ip: string
  }): Promise<{ url: string }>

  // Получить список игр от провайдера (для синхронизации каталога)
  fetchGameList(): Promise<Array<{
    externalGameId: string
    name: string
    type: string
    category: string
    thumbnailUrl?: string
    hasDemo: boolean
    rtp?: number
    metadata?: object
  }>>

  // Верифицировать входящий callback от провайдера
  verifyCallback(headers: object, body: string | object): boolean

  // Парсить callback в единый формат
  parseCallback(headers: object, body: object): ParsedProviderCallback
}
```

### 4.2. Unified Callback Format

Все callback-и от провайдеров парсятся в единый формат:

```typescript
interface ParsedProviderCallback {
  action: 'authenticate' | 'balance' | 'bet' | 'win' | 'rollback'

  // Идентификация игрока
  playerToken?: string      // наш session_token
  playerId?: string         // наш user_id (некоторые провайдеры передают)

  // Для authenticate/balance — ничего дополнительного

  // Для bet
  betAmount?: string
  roundId?: string
  transactionId?: string    // external_transaction_id провайдера
  gameId?: string           // external_game_id

  // Для win
  winAmount?: string

  // Для rollback
  rollbackTransactionId?: string  // какую транзакцию откатить

  // Raw данные для логирования
  rawRequest: object
}
```

### 4.3. Зачем нужен adapter layer

Каждый провайдер имеет свой формат:

- Pragmatic Play отправляет POST с JSON;
- Evolution Gaming использует другой формат;
- BGaming использует третий формат;
- у каждого свои поля, свои названия, свои коды ошибок.

Adapter layer позволяет:

- добавить нового провайдера не трогая основную логику;
- обрабатывать все callback-и через единый `GameCallbackService`;
- тестировать логику кошелька отдельно от специфики провайдера.

---

## 5. Seamless Wallet API Endpoints

Это endpoints которые **вызывает провайдер** на нашем сервере.

Они **НЕ защищены** обычным Auth Guard.

Они защищены:

- signature verification (каждый провайдер подписывает запросы);
- IP whitelist (опционально);
- provider-specific auth (API key / token в headers).

### 5.1. Маршрутизация

Общий URL паттерн:

```
POST /api/v1/provider-callback/:providerSlug
```

Один endpoint на провайдера. Внутри по полям тела запроса определяется action.

Или, если провайдер требует отдельные endpoint-ы:

```
POST /api/v1/provider-callback/:providerSlug/authenticate
POST /api/v1/provider-callback/:providerSlug/balance
POST /api/v1/provider-callback/:providerSlug/bet
POST /api/v1/provider-callback/:providerSlug/win
POST /api/v1/provider-callback/:providerSlug/rollback
```

Конкретная схема зависит от провайдера. Adapter решает как именно парсить.

### 5.2. Callback Use Cases

#### UC-GAME-01: Authenticate Player

Провайдер вызывает этот метод чтобы проверить что игрок валиден и получить его баланс.

**Входные данные от провайдера:** `player_token` / `session_token`.

```
1. Provider adapter парсит запрос
2. Верифицирует подпись
3. Находит game_session по session_token
4. Проверяет что session не expired и не closed
5. Проверяет что user не заблокирован
6. Получает баланс кошелька в валюте сессии
7. Обновляет last_activity_at
8. Формирует ответ в формате провайдера через adapter
```

**Ответ провайдеру:**

```json
{
  "player_id": "user-uuid",
  "currency": "RUB",
  "balance": 15000.00,
  "nickname": "player123"
}
```

> Формат ответа зависит от провайдера. Adapter форматирует ответ.

---

#### UC-GAME-02: Get Balance

```
1. Парсить и верифицировать запрос
2. Найти session по token
3. Получить баланс
4. Вернуть баланс в формате провайдера
```

---

#### UC-GAME-03: Place Bet (Debit)

Провайдер сообщает что игрок сделал ставку. Нужно списать деньги.

**Входные данные:**

- `session_token`
- `amount` (сумма ставки)
- `round_id` (идентификатор раунда игры)
- `transaction_id` (уникальный ID транзакции у провайдера)
- `game_id`

```
1. Парсить и верифицировать запрос через adapter
2. Найти game_session по session_token
3. Проверить что session активна
4. Проверить что user активен (не заблокирован)
5. Проверить idempotency: найти game_transaction по (provider_id, external_transaction_id)
   Если найдена — вернуть текущий баланс (повторный запрос)
6. Найти или создать game_round по (provider_id, external_round_id)
7. Вызвать walletService.debit({
     userId: session.user_id,
     currency: session.currency,
     amount: betAmount,
     type: 'BET',
     idempotencyKey: 'bet_' + provider_id + '_' + transaction_id,
     description: 'Ставка в ' + game.name,
     metadata: {
       provider: providerSlug,
       gameId: game.id,
       roundId: round.id,
       externalTransactionId: transaction_id
     }
   })
8. Если INSUFFICIENT_FUNDS — вернуть ошибку в формате провайдера
9. Создать game_transaction с type = bet
10. Обновить game_round.total_bet += amount
11. Обновить game_session.total_bet += amount
12. Обновить game_session.rounds_played (если новый раунд)
13. Обновить game_session.last_activity_at
14. Получить обновлённый баланс
15. Вернуть баланс в формате провайдера
```

**Ошибки провайдеру:**

Каждый провайдер ожидает свои коды ошибок. Adapter маппит наши ошибки на коды провайдера.

Типичные:

- insufficient funds;
- player not found;
- session expired;
- duplicate transaction;
- internal error.

---

#### UC-GAME-04: Win (Credit)

Провайдер сообщает что игрок выиграл. Нужно зачислить деньги.

**Входные данные:**

- `session_token`
- `amount` (сумма выигрыша, может быть 0)
- `round_id`
- `transaction_id`
- `reference_transaction_id` (ссылка на bet транзакцию, опционально)

```
1. Парсить и верифицировать запрос
2. Найти game_session
3. Проверить idempotency по (provider_id, external_transaction_id)
   Если найдена — вернуть текущий баланс
4. Найти game_round по (provider_id, external_round_id)
5. Если amount > 0:
   a. Вызвать walletService.credit({
        userId: session.user_id,
        currency: session.currency,
        amount: winAmount,
        type: 'WIN',
        idempotencyKey: 'win_' + provider_id + '_' + transaction_id,
        description: 'Выигрыш в ' + game.name,
        metadata: { ... }
      })
6. Если amount = 0 — ничего не зачислять, но записать транзакцию
7. Создать game_transaction с type = win
8. Обновить game_round.total_win += amount
9. Обновить game_session.total_win += amount
10. Обновить game_round.status = closed (если провайдер сигнализирует закрытие)
11. Обновить game_session.last_activity_at
12. Вернуть баланс
```

---

#### UC-GAME-05: Rollback

Провайдер сообщает что предыдущую ставку нужно отменить. Обычно происходит при техническом сбое на стороне провайдера.

**Входные данные:**

- `session_token`
- `transaction_id` (ID транзакции для отката)
- `round_id`

```
1. Парсить и верифицировать запрос
2. Найти game_session
3. Проверить idempotency: если rollback уже был — вернуть баланс
4. Найти game_transaction по (provider_id, external_transaction_id = rollback_transaction_id)
5. Если не найдена — это rollback несуществующей транзакции:
   a. Некоторые провайдеры шлют rollback до bet (race condition)
   b. Создать "phantom" rollback запись и вернуть текущий баланс
6. Если найдена и уже rolled back — вернуть баланс
7. Если найдена и type = bet:
   a. Вызвать walletService.credit({
        userId: session.user_id,
        currency: session.currency,
        amount: originalBetAmount,
        type: 'ROLLBACK',
        idempotencyKey: 'rollback_' + provider_id + '_' + transaction_id,
        description: 'Отмена ставки в ' + game.name,
        metadata: { ... }
      })
   b. Создать game_transaction с type = rollback
   c. Обновить game_round.total_bet -= amount
   d. Обновить game_session.total_bet -= amount
   e. Обновить game_round.status = rolled_back
8. Вернуть баланс
```

---

## 6. Запуск игр

### 6.1. Launch Flow

#### UC-GAME-06: Запустить игру на реальные деньги

```
POST /api/v1/casino/games/:gameSlug/launch
Authorization: Bearer <token>
```

**Входные данные:**

```json
{
  "currency": "RUB",
  "return_url": "https://casino.example.com"
}
```

```
1. Найти game по slug
2. Проверить что game.is_enabled = true
3. Проверить что provider.is_enabled = true
4. Проверить что user.status = active
5. Проверить что у пользователя есть кошелёк в указанной валюте
6. Проверить что валюта поддерживается провайдером
7. Закрыть предыдущую активную сессию этого пользователя у этого провайдера (если есть)
8. Создать game_session:
   - session_token = crypto.randomBytes(32).toString('hex')
   - status = active
   - is_demo = false
9. Определить is_mobile по user-agent
10. Вызвать providerAdapter.getLaunchUrl({
      gameExternalId: game.external_game_id,
      sessionToken: session.session_token,
      playerToken: session.session_token,
      currency: currency,
      language: 'ru',
      returnUrl: return_url,
      isDemo: false,
      isMobile: isMobile,
      ip: req.ip
    })
11. Обновить game.launch_count += 1
12. Вернуть launch URL
```

**Ответ:**

```json
{
  "success": true,
  "data": {
    "session_id": "...",
    "launch_url": "https://provider.example.com/game?token=..."
  }
}
```

---

#### UC-GAME-07: Запустить демо-игру

```
POST /api/v1/casino/games/:gameSlug/demo
```

**Правила:**

- НЕ требует авторизации (гость может играть в демо);
- НЕ создаёт реальную `game_session` с привязкой к кошельку;
- некоторые провайдеры дают отдельный demo URL;
- если провайдер не поддерживает демо — вернуть ошибку;
- можно создать `game_session` с `is_demo = true` для статистики.

**Ответ:**

```json
{
  "success": true,
  "data": {
    "launch_url": "https://provider.example.com/demo?game=..."
  }
}
```

---

## 7. Каталог игр

### 7.1. Публичные endpoints

#### UC-GAME-08: Получить список игр

```
GET /api/v1/casino/games
```

**Параметры запроса:**

```
page            — default 1
per_page        — default 24, max 100
category        — slots | live_casino | table_games | instant_games
type            — slot | live_roulette | live_blackjack | ...
provider        — slug провайдера
search          — поиск по имени
is_featured     — true/false
is_new          — true/false
is_popular      — true/false
sort            — popular | new | name_asc | name_desc | provider
```

**Ответ:**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "slug": "sweet-bonanza",
      "name": "Sweet Bonanza",
      "name_ru": "Sweet Bonanza",
      "provider": {
        "slug": "pragmatic-play",
        "name": "Pragmatic Play"
      },
      "category": "slots",
      "type": "slot",
      "thumbnail_url": "https://...",
      "is_featured": true,
      "is_new": false,
      "is_popular": true,
      "has_demo": true,
      "rtp": 96.51,
      "volatility": "high"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 24,
    "total": 1500,
    "total_pages": 63
  }
}
```

**Правила:**

- возвращать только `is_enabled = true` игры от `is_enabled = true` провайдеров;
- если `sort = popular` — сортировать по `launch_count DESC`;
- если `sort = new` — сортировать по `created_at DESC`;
- поиск по имени — case-insensitive, по `name` и `name_ru`.

---

#### UC-GAME-09: Получить детали игры

```
GET /api/v1/casino/games/:slug
```

**Ответ:** все поля из списка + дополнительно:

- `min_bet`;
- `max_bet`;
- `max_win_multiplier`;
- `tags`;
- `banner_url`;
- `is_favorite` (если пользователь авторизован).

---

#### UC-GAME-10: Получить список провайдеров

```
GET /api/v1/casino/providers
```

**Ответ:**

```json
{
  "success": true,
  "data": [
    {
      "slug": "pragmatic-play",
      "name": "Pragmatic Play",
      "logo_url": "https://...",
      "game_count": 250,
      "type": "slots"
    }
  ]
}
```

**Правила:**

- только `is_enabled = true`;
- `game_count` — количество enabled игр;
- сортировать по `sort_order ASC`.

---

#### UC-GAME-11: Получить категории

```
GET /api/v1/casino/categories
```

**Ответ:**

```json
{
  "success": true,
  "data": [
    { "slug": "slots", "name": "Слоты", "game_count": 1200 },
    { "slug": "live_casino", "name": "Live Казино", "game_count": 200 },
    { "slug": "table_games", "name": "Настольные игры", "game_count": 80 },
    { "slug": "instant_games", "name": "Быстрые игры", "game_count": 20 }
  ]
}
```

**Правила:**

- `game_count` считается из enabled игр;
- категории статичные, определяются enum.

---

#### UC-GAME-12: Добавить игру в избранное

```
POST /api/v1/casino/games/:slug/favorite
Authorization: Bearer <token>
```

---

#### UC-GAME-13: Убрать игру из избранного

```
DELETE /api/v1/casino/games/:slug/favorite
Authorization: Bearer <token>
```

---

#### UC-GAME-14: Получить избранные игры

```
GET /api/v1/casino/favorites
Authorization: Bearer <token>
```

**Параметры:** `page`, `per_page`

---

#### UC-GAME-15: Получить недавно сыгранные игры

```
GET /api/v1/casino/recent
Authorization: Bearer <token>
```

**Алгоритм:**

- выбрать последние `game_sessions` текущего пользователя;
- сгруппировать по `game_id`;
- вернуть уникальные игры в порядке последнего запуска;
- лимит: 20 игр.

---

## 8. История игровых сессий

#### UC-GAME-16: Получить историю ставок пользователя

```
GET /api/v1/casino/history
Authorization: Bearer <token>
```

**Параметры:** `page`, `per_page`, `game_id`, `provider`, `from`, `to`

**Ответ:**

```json
{
  "success": true,
  "data": [
    {
      "round_id": "...",
      "game": {
        "slug": "sweet-bonanza",
        "name": "Sweet Bonanza",
        "provider": "Pragmatic Play"
      },
      "currency": "RUB",
      "total_bet": "100.00",
      "total_win": "350.00",
      "profit": "250.00",
      "status": "closed",
      "created_at": "2024-01-01T15:30:00Z"
    }
  ],
  "meta": { ... }
}
```

**Правила:**

- показывать на уровне `game_rounds` (не отдельных транзакций);
- `profit = total_win - total_bet`;
- сортировать по `created_at DESC`.

---

## 9. Admin операции

#### UC-GAME-17: Управление провайдерами (Admin)

```
GET    /api/v1/admin/providers                — список всех
GET    /api/v1/admin/providers/:id             — детали
POST   /api/v1/admin/providers                 — создать
PATCH  /api/v1/admin/providers/:id             — обновить
POST   /api/v1/admin/providers/:id/enable      — включить
POST   /api/v1/admin/providers/:id/disable     — выключить
```

**При создании провайдера:**

```json
{
  "slug": "pragmatic-play",
  "name": "Pragmatic Play",
  "type": "slots",
  "api_url": "https://api.pragmatic...",
  "api_key": "...",
  "api_secret": "...",
  "config": { ... }
}
```

**При выключении провайдера:**

- все его игры становятся недоступны для запуска;
- текущие активные сессии продолжают работать;
- в каталоге игры провайдера не показываются.

---

#### UC-GAME-18: Управление играми (Admin)

```
GET    /api/v1/admin/games                     — список с фильтрами
GET    /api/v1/admin/games/:id                 — детали
PATCH  /api/v1/admin/games/:id                 — обновить
POST   /api/v1/admin/games/:id/enable          — включить
POST   /api/v1/admin/games/:id/disable         — выключить
POST   /api/v1/admin/games/:id/feature         — пометить как featured
POST   /api/v1/admin/games/:id/unfeature       — убрать featured
```

**Обновление игры (admin):**

```json
{
  "name_ru": "Сладкая Бонанза",
  "is_new": false,
  "is_popular": true,
  "sort_order": 10,
  "tags": ["bonus_buy", "megaways"]
}
```

---

#### UC-GAME-19: Синхронизация каталога игр от провайдера (Admin)

```
POST /api/v1/admin/providers/:id/sync-games
```

```
1. Вызвать providerAdapter.fetchGameList()
2. Для каждой игры из списка:
   a. Найти по (provider_id, external_game_id)
   b. Если не найдена — создать новую запись с is_enabled = false
   c. Если найдена — обновить name, thumbnail_url, rtp и т.д.
3. Обновить game_count у провайдера
4. Вернуть отчёт: добавлено X, обновлено Y, всего Z
```

**Правила:**

- новые игры создаются с `is_enabled = false` — admin вручную включает;
- slug генерируется автоматически из name: «Sweet Bonanza» → `sweet-bonanza`;
- при дубликате slug — добавлять суффикс provider: `sweet-bonanza-pragmatic`.

---

#### UC-GAME-20: Просмотр игровых сессий (Admin)

```
GET /api/v1/admin/game-sessions
```

**Параметры:** `page`, `per_page`, `user_id`, `game_id`, `provider_id`, `status`, `from`, `to`

**Ответ включает:**

- данные сессии;
- данные игры;
- данные пользователя;
- `total_bet`, `total_win`, `rounds_played`.

---

#### UC-GAME-21: Детали игровой сессии (Admin)

```
GET /api/v1/admin/game-sessions/:id
```

**Включает:**

- все поля сессии;
- список `game_rounds` с транзакциями;
- связанные `ledger_entries`.

---

#### UC-GAME-22: Просмотр game_transactions (Admin)

```
GET /api/v1/admin/game-transactions
```

**Параметры:** `page`, `per_page`, `user_id`, `provider_id`, `type`, `round_id`, `from`, `to`

---

## 10. Session Management

### 10.1. Expiration

Активные `game_sessions` должны автоматически закрываться.

BullMQ cron job, каждые 10 минут:

```
Найти все game_sessions где:
  status = active
  AND last_activity_at < now() - interval '2 hours'

Для каждой:
  status = expired
  closed_at = now()
```

### 10.2. Одна сессия на провайдера

Пользователь может иметь только одну активную сессию у одного провайдера одновременно.

При запуске новой игры у того же провайдера — предыдущая сессия закрывается автоматически.

У разных провайдеров одновременно могут быть активные сессии.

### 10.3. Session Token Security

- `session_token` длиной 64 символа hex;
- должен быть непредсказуемым (`crypto.randomBytes`);
- передаётся провайдеру при создании launch URL;
- провайдер отправляет его обратно в callback-ах;
- по нему мы идентифицируем пользователя и сессию.

---

## 11. Обработка ошибок в callback-ах

### 11.1. Общие правила

- callback endpoint **всегда** должен возвращать ответ, даже при ошибке;
- провайдер ожидает ответ в определённом формате и с определённым HTTP кодом;
- **5xx от нашего сервера = провайдер будет ретраить**;
- каждый провайдер имеет свои коды ошибок;
- adapter маппит наши внутренние ошибки на коды провайдера.

### 11.2. Маппинг ошибок

```
INSUFFICIENT_FUNDS        → провайдер-специфичный код "not enough balance"
PLAYER_NOT_FOUND          → "player not found" / "invalid token"
SESSION_EXPIRED           → "session expired"
DUPLICATE_TRANSACTION     → вернуть текущий баланс (idempotent)
PLAYER_BLOCKED            → "player disabled"
INTERNAL_ERROR            → "internal error" (500)
```

### 11.3. Logging

Для callback-ов логировать:

- полный raw запрос;
- parsed action;
- результат обработки;
- время обработки;
- ошибки.

---

## 12. Provider-specific Adapters

### 12.1. Структура файлов

```
modules/casino/
  infrastructure/
    providers/
      provider-adapter.interface.ts    — интерфейс
      provider-adapter.factory.ts      — фабрика: по slug → adapter
      pragmatic-play/
        pragmatic-play.adapter.ts
        pragmatic-play.mapper.ts       — маппинг запросов/ответов
        pragmatic-play.types.ts        — типы API Pragmatic Play
        pragmatic-play.constants.ts
      evolution/
        evolution.adapter.ts
        evolution.mapper.ts
        evolution.types.ts
      bgaming/
        bgaming.adapter.ts
        ...
      // каждый новый провайдер — отдельная папка
```

### 12.2. Provider Adapter Factory

```typescript
class ProviderAdapterFactory {
  getAdapter(providerSlug: string): GameProviderAdapter {
    switch (providerSlug) {
      case 'pragmatic-play':
        return new PragmaticPlayAdapter(config);
      case 'evolution':
        return new EvolutionAdapter(config);
      case 'bgaming':
        return new BGamingAdapter(config);
      default:
        throw new ProviderNotSupportedError(providerSlug);
    }
  }
}
```

### 12.3. Добавление нового провайдера

Чтобы добавить нового провайдера, нужно:

1. Создать папку `providers/new-provider/`.
2. Реализовать `NewProviderAdapter` имплементирующий `GameProviderAdapter`.
3. Реализовать маппинг callback-ов в единый формат.
4. Реализовать маппинг ошибок.
5. Добавить в `ProviderAdapterFactory`.
6. Создать запись в `game_providers`.
7. Синхронизировать каталог игр.
8. Включить провайдера.

> Вся остальная логика (wallet operations, session management, round tracking) работает без изменений.

---

## 13. Demo Provider для разработки

### 13.1. Зачем нужен

При разработке реальные провайдеры недоступны без договора. Нужен mock-провайдер для тестирования всего flow.

### 13.2. Как работает

Создать `DemoProviderAdapter`:

- `getLaunchUrl` — возвращает URL на нашу собственную demo-страницу;
- `fetchGameList` — возвращает 10 фейковых игр;
- `verifyCallback` — всегда true;
- `parseCallback` — стандартный формат.

Создать demo game page (`/demo-game`) в frontend:

- простая страница с кнопками «Bet 10», «Bet 50», «Bet 100»;
- кнопка «Win» (случайный множитель);
- кнопка «Lose» (win = 0);
- при нажатии — отправляет callback на наш Wallet API;
- показывает текущий баланс.

Это позволяет полностью протестировать:

- создание сессии;
- authenticate callback;
- balance callback;
- bet callback;
- win callback;
- rollback callback;
- историю ставок;
- обновление баланса.

---

## 14. Events

Модуль Casino должен эмитить:

```
GAME_SESSION_STARTED
  payload: { userId, gameId, providerId, sessionId, currency, isDemo }

GAME_SESSION_CLOSED
  payload: { userId, sessionId, totalBet, totalWin, roundsPlayed }

GAME_BET_PLACED
  payload: { userId, gameId, providerId, amount, currency, roundId }

GAME_WIN_CREDITED
  payload: { userId, gameId, providerId, amount, currency, roundId }

GAME_ROUND_COMPLETED
  payload: { userId, gameId, roundId, totalBet, totalWin }
```

**Подписчики:**

- `notification module` — опционально уведомлять о крупных выигрышах;
- `admin module` — real-time dashboard;
- `referral module` — может реагировать на GGR для расчёта реферальных.

---

## 15. Performance и Caching

### 15.1. Каталог игр

Каталог игр кешировать в Redis:

- ключ: `games:catalog:${category}:${page}:${sort}`;
- TTL: 5 минут;
- инвалидировать при включении/выключении игры или провайдера;
- инвалидировать при `sync-games`.

### 15.2. Provider config

Конфигурацию провайдера кешировать в Redis:

- ключ: `provider:config:${slug}`;
- TTL: 10 минут;
- инвалидировать при обновлении.

### 15.3. Callback performance

Callback endpoints от провайдеров должны отвечать быстро:

- целевое время ответа: < 200ms;
- если кошелёк не успевает — провайдер может показать ошибку игроку;
- не делать тяжёлых операций в callback (email, analytics) — всё через BullMQ.

---

## 16. Технические задачи Части 4

### Блок A. Casino Module — Core

**Задачи:**

1. Создать `modules/casino`.
2. Создать Prisma schema для `game_providers`, `games`, `game_sessions`, `game_rounds`, `game_transactions`, `game_favorites`.
3. Реализовать `GameProviderAdapter` interface.
4. Реализовать `ProviderAdapterFactory`.
5. Реализовать `DemoProviderAdapter` для тестирования.
6. Реализовать `GameSessionService` (создание, закрытие, expiration).
7. Реализовать `session_token` генерацию.

**Критерий приёмки:**

- таблицы созданы, миграции применяются;
- `DemoProvider` возвращает launch URL;
- сессия создаётся и закрывается;
- одна активная сессия на провайдера на пользователя.

---

### Блок B. Seamless Wallet API

**Задачи:**

1. Реализовать callback endpoint маршрутизацию.
2. Реализовать `GameCallbackService` с единой логикой обработки.
3. Реализовать authenticate callback.
4. Реализовать balance callback.
5. Реализовать bet callback с интеграцией wallet debit.
6. Реализовать win callback с интеграцией wallet credit.
7. Реализовать rollback callback.
8. Реализовать idempotency проверку для game_transactions.
9. Реализовать создание/обновление game_rounds.
10. Реализовать маппинг ошибок для провайдера.

**Критерий приёмки:**

- через `DemoProvider` можно сделать полный цикл: запуск → bet → win;
- баланс корректно списывается при bet;
- баланс корректно зачисляется при win;
- rollback возвращает деньги;
- дублированные callback-и не дублируют операции;
- `game_rounds` и `game_transactions` корректно записываются;
- `ledger_entries` создаются для каждой операции.

---

### Блок C. Game Catalog API

**Задачи:**

1. Реализовать `GET /api/v1/casino/games` с фильтрами и пагинацией.
2. Реализовать `GET /api/v1/casino/games/:slug`.
3. Реализовать `GET /api/v1/casino/providers`.
4. Реализовать `GET /api/v1/casino/categories`.
5. Реализовать `POST/DELETE /api/v1/casino/games/:slug/favorite`.
6. Реализовать `GET /api/v1/casino/favorites`.
7. Реализовать `GET /api/v1/casino/recent`.
8. Реализовать `GET /api/v1/casino/history`.
9. Настроить кеширование каталога в Redis.

**Критерий приёмки:**

- каталог возвращает только enabled игры;
- фильтры по категории, провайдеру, поиску работают;
- сортировки работают;
- избранное работает;
- недавние игры показываются;
- история ставок с пагинацией работает.

---

### Блок D. Game Launch

**Задачи:**

1. Реализовать `POST /api/v1/casino/games/:slug/launch`.
2. Реализовать `POST /api/v1/casino/games/:slug/demo`.
3. Реализовать валидацию валюты и баланса.
4. Реализовать автозакрытие предыдущей сессии.
5. Реализовать `launch_count` increment.

**Критерий приёмки:**

- launch создаёт сессию и возвращает URL;
- demo работает без авторизации;
- предыдущая сессия закрывается;
- disabled игра не запускается.

---

### Блок E. Admin Casino

**Задачи:**

1. Реализовать CRUD для провайдеров (admin).
2. Реализовать enable/disable для провайдеров.
3. Реализовать список игр с фильтрами (admin).
4. Реализовать enable/disable/feature для игр.
5. Реализовать `sync-games` endpoint.
6. Реализовать просмотр `game-sessions` (admin).
7. Реализовать детали `game-session` с раундами и транзакциями.
8. Реализовать просмотр `game-transactions` (admin).

**Критерий приёмки:**

- провайдеры создаются, включаются, выключаются;
- `sync-games` добавляет новые игры;
- admin видит все сессии и транзакции;
- все admin действия логируются в audit.

---

### Блок F. Demo Provider и Demo Game Page

**Задачи:**

1. Реализовать `DemoProviderAdapter` полностью.
2. Создать demo game page на frontend.
3. Demo page отправляет callback-и на наш API.
4. Показывает баланс и результат.

**Критерий приёмки:**

- полный цикл тестируется через demo без реального провайдера;
- bet списывает, win зачисляет, rollback откатывает;
- история ставок показывает demo-игры.

---

### Блок G. Scheduled Jobs

**Задачи:**

1. Реализовать cron job для закрытия expired sessions.

**Критерий приёмки:**

- неактивные сессии старше 2 часов автоматически закрываются.

---

## 17. Что НЕ делать в Части 4

- не интегрировать реальных провайдеров (только DemoProvider и подготовленная архитектура);
- не делать in-house игры (Crash, Mines и т.д.);
- не делать real-time WebSocket трансляцию ставок;
- не делать систему турниров;
- не делать jackpot систему;
- не оптимизировать производительность до полного функционала.

---

_Если готов — напиши **«продолжай»**, и я дам **Часть 5: Frontend Web — витрина, личный кабинет, кошелёк, история**._
