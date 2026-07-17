---
title: Provider Integration Strategy
description: Архитектура интеграции с game-провайдерами, Seamless Wallet API, catalog & launch
status: living document
last_updated: 2026-06-19
---

# Provider Integration Strategy

> **Назначение:** Описать как backend интегрируется с внешними game-провайдерами (Pragmatic Play, Evolution, BGaming и т.д.) через единый Seamless Wallet API.

---

## 1. Концепция: Seamless Wallet

### 1.1. Определение

**Seamless Wallet API** — это архитектура, в которой игрок использует **единый кошелёк казино** для всех игр всех провайдеров. Провайдер **НЕ управляет деньгами** игрока; backend казино — единственный источник истины баланса.

### 1.2. Альтернатива: Transfer Wallet

В Transfer Wallet провайдер управляет деньгами во время игры. Игрок "переводит" средства провайдеру → играет → возвращает остаток. Это менее удобно для игрока и более затратно для казино (больше транзакций).

На MVP — **Seamless Wallet**.

### 1.3. Поток игры

```
┌──────────┐                ┌──────────┐             ┌─────────────┐
│   User   │                │  Casino  │             │  Provider   │
│ Browser  │                │ Backend  │             │ (e.g. Prag.)│
└────┬─────┘                └────┬─────┘             └──────┬──────┘
     │                           │                          │
     │ 1. POST /casino/games/SweetBonanza/launch            │
     ├──────────────────────────►│                          │
     │                           │ 2. Authenticate user     │
     │                           │ 3. Get active currency   │
     │                           │ 4. Create game_session    │
     │                           │ 5. Generate HMAC token   │
     │ 6. Response: launchUrl    │                          │
     │◄──────────────────────────┤                          │
     │                           │                          │
     │ 7. iframe src=launchUrl   │                          │
     ├───────────────────────────────────────────────────────►│
     │                           │                          │
     │                           │ 8. Provider authenticate │
     │                           │◄─────────────────────────┤
     │                           │ { token, session_id }    │
     │                           │                          │
     │                           │ 9. wallet.balance query  │
     │                           ├─────────────────────────►│
     │                           │ { balance: 150.00 }      │
     │                           │◄─────────────────────────┤
     │                           │                          │
     │ 10. User plays — spins, bets                          │
     ├───────────────────────────────────────────────────────►│
     │                           │                          │
     │                           │ 11. bet(1.00) callback   │
     │                           │◄─────────────────────────┤
     │                           │ game_session_id          │
     │                           │ transaction_id           │
     │                           │ amount: 1.00             │
     │                           │                          │
     │                           │ 12. wallet.debit(1.00)   │
     │                           │ 13. Create ledger_entry  │
     │                           │ 14. Return new balance   │
     │                           │ { balance: 149.00 }      │
     │                           ├─────────────────────────►│
     │                           │                          │
     │                           │ 15. (eventually win)     │
     │                           │ win(2.50) callback       │
     │                           │◄─────────────────────────┤
     │                           │                          │
     │                           │ 16. wallet.credit(2.50)  │
     │                           │ { balance: 151.50 }      │
     │                           ├─────────────────────────►│
     │ 17. UI updates balance    │                          │
     │◄──────────────────────────┤                          │
```

---

## 2. Game-Provider Adapter Layer

### 2.1. Интерфейс адаптера

```typescript
// casino/infrastructure/adapters/game-provider.adapter.interface.ts

export interface GameProviderAdapter {
  readonly name: string              // 'pragmatic-play', 'evolution', etc.
  readonly type: 'seamless' | 'transfer'
  
  // ── Каталог ─────────────────────────────────────────
  fetchGames(): Promise<ProviderGame[]>
  fetchSingleGame(externalId: string): Promise<ProviderGame | null>
  
  // ── Game Launch ─────────────────────────────────────
  generateLaunchUrl(input: LaunchGameInput): Promise<LaunchUrl>
}

export interface ProviderGame {
  externalId: string                 // provider's game ID
  name: string
  category: 'slots' | 'live' | 'table' | 'crash' | 'instant'
  thumbnailUrl: string
  rtp: number                        // 96.51
  volatility: 'low' | 'medium' | 'high'
  minBet: MoneyAmount
  maxBet: MoneyAmount
  providerMeta: Record<string, unknown>
}

export interface LaunchGameInput {
  userId: string
  currency: Currency
  gameExternalId: string
  sessionId: string                  // our internal session_id
  locale: 'ru'
  returnUrl: string                  // URL для возврата в casino
  isDemo: boolean
}

export interface LaunchUrl {
  url: string
  expiresAt: Date
  token: string                      // HMAC token для verify
}
```

### 2.2. Провайдеры на MVP

| Provider | Type | Status |
|----------|------|--------|
| **DemoProvider** | Seamless | ✅ Реализован на MVP |
| Pragmatic Play | Seamless | ⏳ Опционально (фаза 2) |
| Evolution | Seamless | ⏳ Опционально |
| BGaming | Seamless | ⏳ Опционально |

### 2.3. DemoProvider (для разработки)

`DemoProvider` — это **внутренняя имплементация**, генерирующая iframe с HTML-симуляцией слотов. Не делает внешних запросов.

Используется для:
- Разработки UI без реальных провайдеров
- QA / manual testing
- Demo mode для пользователей (без регистрации)

```typescript
@Injectable()
export class DemoProviderAdapter implements GameProviderAdapter {
  readonly name = 'demo'
  readonly type = 'seamless'
  
  private games: ProviderGame[] = [
    {
      externalId: 'demo-sweet-bonanza',
      name: 'Sweet Bonanza (Demo)',
      category: 'slots',
      thumbnailUrl: '/demo-games/sweet-bonanza.png',
      rtp: 96.51,
      volatility: 'high',
      minBet: '0.20',
      maxBet: '100.00',
      providerMeta: {},
    },
    // ... 20 demo games
  ]
  
  async fetchGames() {
    return this.games
  }
  
  async generateLaunchUrl(input: LaunchGameInput): Promise<LaunchUrl> {
    // Генерируем URL на наш собственный demo-game page
    const game = this.games.find(g => g.externalId === input.gameExternalId)
    if (!game) throw new GameNotFoundError()
    
    const token = this.jwtService.sign(
      {
        userId: input.userId,
        sessionId: input.sessionId,
        currency: input.currency,
        gameId: input.gameExternalId,
      },
      { expiresIn: '15m' }
    )
    
    const url = `${env.APP_URL}/demo-game/${input.gameExternalId}?token=${token}&demo=${input.isDemo}`
    
    return {
      url,
      token,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    }
  }
}
```

---

## 3. Game Sessions

### 3.1. Жизненный цикл

```
Created ──→ Active ──→ Closed
   │           │           │
   │ 30min     │ manual    │ timeout
   │ inactivity│ API or    │ 24h
   │           │ provider  │
```

### 3.2. Структура таблицы

```prisma
model game_sessions {
  id              String   @id @default(uuid())
  user_id         String
  game_id         String   // FK to games.id
  provider_id     String   // FK to game_providers.id
  currency        String   // RUB, USDT_TRC20, ...
  opened_at       DateTime @default(now())
  closed_at       DateTime?
  total_bets      Decimal  @default(0) @db.Decimal(20, 8)
  total_wins      Decimal  @default(0) @db.Decimal(20, 8)
  rounds_count    Int      @default(0)
  ip              String?
  user_agent      String?
  
  status          GameSessionStatus @default(active)
  
  // Relations
  user            User     @relation(fields: [user_id], references: [id])
  game            Game     @relation(fields: [game_id], references: [id])
  provider        GameProvider @relation(fields: [provider_id], references: [id])
  rounds          GameRound[]
  transactions    GameTransaction[]
  
  @@index([user_id])
  @@index([status])
  @@index([opened_at])
  @@map("game_sessions")
}

enum GameSessionStatus {
  active
  closed
  expired
}
```

---

## 4. Provider Callbacks (Seamless Wallet)

### 4.1. Типы callbacks

| Callback | Описание |
|----------|----------|
| `authenticate` | Provider проверяет HMAC token при загрузке iframe |
| `balance` | Provider запрашивает текущий баланс игрока |
| `bet` | Списание ставки |
| `win` | Зачисление выигрыша |
| `rollback` | Откат ставки (если раунд отменён) |
| `refund` | Возврат средств (игра закрыта с остатком) |

### 4.2. authenticate callback

**Запрос от провайдера:**

```http
POST /provider-callback/{provider}/authenticate
Content-Type: application/json

{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "ip": "1.2.3.4"
}
```

**Ответ:**

```json
{
  "userId": "user-uuid",
  "currency": "RUB",
  "country": "RU",
  "isVerified": true
}
```

### 4.3. balance callback

**Запрос:**

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Ответ:**

```json
{
  "balance": "150.00",
  "currency": "RUB"
}
```

### 4.4. bet callback

**Запрос:**

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "transactionId": "tx-abc-123",
  "roundId": "round-xyz",
  "amount": "1.00",
  "currency": "RUB"
}
```

**Обработка:**

```
1. Verify HMAC token
2. Check transactionId uniqueness (idempotency)
3. wallet.debit(userId, currency, amount, 'BET', `bet_${transactionId}`)
4. Update game_round.bet_amount += amount
5. Update game_session.total_bets += amount
6. Return new balance
```

**Ответ:**

```json
{
  "balance": "149.00",
  "transactionId": "tx-abc-123"  // echo for confirmation
}
```

**Ошибка (insufficient funds):**

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Недостаточно средств"
  }
}
```

### 4.5. win callback

**Запрос:**

```json
{
  "sessionId": "...",
  "transactionId": "win-abc-456",
  "roundId": "round-xyz",
  "amount": "2.50",
  "currency": "RUB"
}
```

**Обработка:** симметрично `bet`, но `wallet.credit()`.

### 4.6. rollback callback

**Запрос:**

```json
{
  "sessionId": "...",
  "transactionId": "rb-abc-789",
  "originalTransactionId": "tx-abc-123",  // bet, который откатывается
  "amount": "1.00"
}
```

**Когда:**

- Игра отменила раунд
- Технический сбой во время раунда
- Провайдер обнаружил невалидный outcome

**Обработка:**

```
1. Найти оригинальную bet транзакцию
2. Если ранее не было rollback — wallet.credit(amount, 'ROLLBACK')
3. Если уже был — вернуть текущий баланс (idempotent)
```

### 4.7. refund callback

**Когда:** сессия закрывается с ненулевым остатком провайдера (Transfer Wallet). На Seamless **НЕ используется** — баланс всегда у нас.

---

## 5. Game Catalog

### 5.1. Структура таблиц

```prisma
model game_providers {
  id              String   @id @default(uuid())
  name            String   // "Pragmatic Play"
  slug            String   @unique // "pragmatic-play"
  api_endpoint    String?  // null для DemoProvider
  api_key         String?  // encrypted
  config          Json?
  is_enabled      Boolean  @default(true)
  is_demo         Boolean  @default(false)
  last_sync_at    DateTime?
  
  games           Game[]
  
  @@map("game_providers")
}

model games {
  id              String   @id @default(uuid())
  provider_id     String
  external_id     String   // provider's ID
  name            String
  slug            String   @unique
  category        GameCategory
  thumbnail_url   String
  rtp             Decimal? @db.Decimal(5, 2)
  volatility      GameVolatility?
  min_bet         Decimal? @db.Decimal(20, 8)
  max_bet         Decimal? @db.Decimal(20, 8)
  description     String?
  
  is_enabled      Boolean  @default(false)    // ⚠️ new games = disabled by default
  is_new          Boolean  @default(false)
  is_popular      Boolean  @default(false)
  is_featured     Boolean  @default(false)
  sort_order      Int      @default(100)
  tags            String[]
  
  provider        GameProvider @relation(fields: [provider_id], references: [id])
  sessions        GameSession[]
  
  @@unique([provider_id, external_id])
  @@index([category])
  @@index([is_enabled])
  @@index([sort_order])
  @@map("games")
}

enum GameCategory {
  slots
  live_casino
  table_games
  crash_games
  instant_games
  lottery
  virtual_sports
}

enum GameVolatility {
  low
  medium
  high
}
```

### 5.2. Каталог endpoints (User side)

```
GET /api/v1/casino/games
  ?category=slots
  &provider=pragmatic-play
  &search=sweet
  &sort=popular|new|name
  &order=asc|desc
  &page=1
  &per-page=24

GET /api/v1/casino/games/:slug               ← детали игры
GET /api/v1/casino/featured                 ← featured игры
GET /api/v1/casino/new                      ← новинки
GET /api/v1/casino/popular                  ← популярные
GET /api/v1/casino/categories               ← список категорий
GET /api/v1/casino/providers                ← список провайдеров
GET /api/v1/casino/providers/:slug          ← игры провайдера
```

### 5.3. Каталог endpoints (Admin)

```
GET    /api/v1/admin/games                  ← с фильтрами
PATCH  /api/v1/admin/games/:id              ← название, категория, is_featured
POST   /api/v1/admin/games/:id/enable
POST   /api/v1/admin/games/:id/disable
POST   /api/v1/admin/games/batch-enable
POST   /api/v1/admin/games/batch-disable
POST   /api/v1/admin/games/batch-feature

GET    /api/v1/admin/providers
GET    /api/v1/admin/providers/:id
PATCH  /api/v1/admin/providers/:id          ← config, credentials
POST   /api/v1/admin/providers/:id/sync     ← Sync games
POST   /api/v1/admin/providers/:id/enable
POST   /api/v1/admin/providers/:id/disable
```

---

## 6. Game Launch Flow

### 6.1. User launches game

```
1. POST /api/v1/casino/games/SweetBonanza/launch
   Headers: Authorization: Bearer ...

2. Backend:
   - Validate session (auth required)
   - Validate user has active wallet in game's currency
   - Get game config
   - Create game_session (status=active)
   - Generate launch URL via adapter.generateLaunchUrl()
   - Return launchUrl

3. Frontend:
   - Show loading
   - Open iframe with src=launchUrl
   - Listen for events from iframe (postMessage)

4. User plays in iframe
   - Provider calls our callbacks (authenticate, balance, bet, win)
   - We update wallet/round/ledger

5. User closes iframe
   - Game session auto-closes after 30 min inactivity
   - Or user clicks "Закрыть" → manual close
```

### 6.2. Demo launch (без авторизации)

```
1. POST /api/v1/casino/games/SweetBonanza/demo
   No auth required

2. Backend:
   - Get demo game config
   - Generate demo session (userId = "demo", currency = "DEMO")
   - Demo session doesn't touch real wallet
   - Return demoLaunchUrl

3. Frontend:
   - Open iframe with src=demoLaunchUrl
   - Provider shows "DEMO" mode
   - No money involved
```

### 6.3. Currency selection

Если у пользователя несколько кошельков в поддерживаемых валютах — показываем модалку выбора:

```typescript
async launchGame(userId: string, gameSlug: string) {
  const game = await this.gameRepo.findBySlug(gameSlug)
  
  const userBalances = await this.walletFacade.getBalances(userId)
  const compatibleBalances = userBalances.filter(b => 
    SUPPORTED_CURRENCIES.includes(b.currency) && 
    new Decimal(b.availableBalance).gt(0)
  )
  
  if (compatibleBalances.length === 0) {
    throw new InsufficientFundsError(
      `Need to deposit to one of: ${SUPPORTED_CURRENCIES.join(', ')}`
    )
  }
  
  if (compatibleBalances.length === 1) {
    return this.launch(userId, game, compatibleBalances[0].currency)
  }
  
  // Multiple — return options to frontend
  return { requiresCurrencyChoice: true, options: compatibleBalances }
}
```

---

## 7. Sync Games (Cron / Manual)

### 7.1. Admin кнопка "Sync games"

```typescript
async syncProviderGames(providerId: string) {
  const provider = await this.providerRepo.findById(providerId)
  const adapter = this.adapters.get(provider.name)
  
  const providerGames = await adapter.fetchGames()
  
  const result = { added: 0, updated: 0, total: 0 }
  
  for (const providerGame of providerGames) {
    const existing = await this.gameRepo.findByProviderAndExternalId(
      provider.id, providerGame.externalId
    )
    
    if (!existing) {
      await this.gameRepo.create({
        ...providerGame,
        provider_id: provider.id,
        is_enabled: false,  // ⚠️ new games disabled by default
        is_new: true,       // mark as new
      })
      result.added++
    } else {
      // Update только определённые поля, не трогать admin overrides
      await this.gameRepo.update(existing.id, {
        name: providerGame.name,
        thumbnail_url: providerGame.thumbnailUrl,
        rtp: providerGame.rtp,
        // НЕ обновлять is_enabled, is_featured, sort_order
      })
      result.updated++
    }
  }
  
  result.total = providerGames.length
  
  await this.auditLog.log({
    actorId: admin.id,
    actorType: 'admin',
    action: 'PROVIDER_SYNC',
    entityType: 'provider',
    entityId: providerId,
    data: result,
  })
  
  return result
}
```

### 7.2. Cron auto-sync (опционально)

```typescript
@Cron('0 0 * * *')  // каждый день в 00:00
async autoSyncAllProviders() {
  const enabled = await this.providerRepo.findAllEnabled()
  for (const provider of enabled) {
    if (provider.is_demo) continue
    
    try {
      await this.syncProvider(provider.id)
    } catch (err) {
      logger.error({ err, providerId: provider.id }, 'Auto-sync failed')
    }
  }
}
```

---

## 8. Favorites

### 8.1. Кнопка "В избранное"

```typescript
// User добавляет игру в избранное
POST /api/v1/casino/games/:slug/favorite
Body: { favorite: true } | { favorite: false }

// Таблица
model game_favorites {
  user_id   String
  game_id   String
  added_at  DateTime @default(now())
  
  @@id([user_id, game_id])
  @@map("game_favorites")
}
```

### 8.2. Отображение

```typescript
async getFavorites(userId: string): Promise<Game[]> {
  return this.prisma.game.findMany({
    where: {
      favorites: { some: { user_id: userId } },
    },
    include: { provider: true },
    orderBy: { favorites: { _count: 'desc' } },
  })
}
```

---

## 9. Добавление нового провайдера

### Чеклист

1. ☐ Создать `NewProviderAdapter implements GameProviderAdapter`
2. ☐ Реализовать `fetchGames()` (HTTP call к API провайдера)
3. ☐ Реализовать `generateLaunchUrl()` (HMAC signing)
4. ☐ Добавить webhook handler `POST /provider-callback/{slug}/...`
5. ☐ Проверить HMAC signature format провайдера
6. ☐ Зарегистрировать адаптер в `casino.module.ts`
7. ☐ Добавить env-переменные (API keys, URLs)
8. ☐ Добавить seed provider в admin (через миграцию)
9. ☐ Manual sync games через admin
10. ☐ Тест launch + bet + win flow
11. ☐ Anti-fraud проверки (max bet, etc.)

---

## 10. Anti-Fraud на Provider уровне

### 10.1. Лимиты

```typescript
const ANTI_FRAUD_LIMITS = {
  MAX_BET_PER_ROUND: '100000.00',     // 100k RUB max bet
  MAX_BET_MULTIPLIER: 10000,           // max win = bet × 10000
  MIN_BET_INTERVAL_MS: 100,            // min 100ms between bets
  MAX_BETS_PER_MINUTE: 300,            // max 5 bets/sec
  MAX_SESSION_DURATION_HOURS: 24,
}
```

### 10.2. Suspicious activity detection

```typescript
async checkSuspiciousActivity(sessionId: string) {
  const session = await this.sessionRepo.findById(sessionId)
  const recentTransactions = await this.txRepo.findBySession(session.id, { last: 60 })
  
  // Pattern 1: слишком частые выигрыши
  const winCount = recentTransactions.filter(t => t.type === 'WIN').length
  if (winCount > 50) {
    await this.alertAdmin('Suspicious win pattern', session)
  }
  
  // Pattern 2: подозрительный multiplier
  const recentBets = recentTransactions.filter(t => t.type === 'BET')
  const recentWins = recentTransactions.filter(t => t.type === 'WIN')
  
  for (const win of recentWins) {
    const matchingBet = recentBets.find(b => b.round_id === win.round_id)
    if (matchingBet) {
      const multiplier = new Decimal(win.amount).div(matchingBet.amount)
      if (multiplier.gt(1000)) {
        await this.alertAdmin('High win multiplier', { sessionId, multiplier })
      }
    }
  }
}
```

---

> **Главный принцип:** баланс — **только через WalletFacade**. Provider callbacks могут триггерить wallet операции, но никогда не должны делать это параллельно.
