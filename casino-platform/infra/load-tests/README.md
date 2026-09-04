# Load Tests (GAP-47)

k6-сценарии для нагрузочного тестирования casino-platform.

## Установка k6

k6 — **отдельный бинарь** (не Node.js, не npm-пакет). Установить одним из способов:

```bash
# macOS
brew install k6

# Linux (apt)
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker
docker run --rm -i grafana/k6 run - <infra/load-tests/wallet-concurrency.js
```

Версия: k6 v0.45+ (для импортов ESM-style `import http from 'k6/http'`).

## wallet-concurrency.js

Профиль: **казино с одним игроком, много ставок в секунду** — самый тяжёлый кейс для wallet.ledger с optimistic-lock retry.

### Что бьёт

`POST /api/v1/provider-callback/gitslotpark/withdraw` — это GitSlotPark-op, который адаптер мапит на `action=bet` (см. `apps/api/test/gitslotpark-adapter.spec.ts`, GAP-43). Внутри: `wallet.runInTransaction → wallet.debit` с `Serializable` isolation и 3 retry-попытками (backoff 50·n²).

### Профили нагрузки

| Ступень | VU | Длительность |
|---------|-----|--------------|
| warm-up | 10 | 15s ramp + 30s |
| middle | 50 | 15s ramp + 30s |
| peak | 100 | 15s ramp + 30s |
| cool-down | 0 | 15s ramp-down |

### Метрики (thresholds)

- `http_req_duration p(95) < 500ms` — если выше, нужно оптимизировать ledger.
- `http_req_failed rate < 0.01` — если выше, optimistic-lock retry исчерпан → нужны advisory-локи или очередь на кошелёк.

Кастомные сигналы в логе: `status=11` (DUPLICATE_TRANSACTION) — это индикатор исчерпания retry.

### Подготовка стенда

Стенд **не** запускается в CI (нужна изолированная БД — см. критерий 2 GAP-47). Шаги:

1. **Поднять API** с тестовыми провайдер-ключами:

   ```bash
   # .env.stend (или экспорт в shell)
   DATABASE_URL=postgresql://loadtest:loadtest@localhost:5433/casino_loadtest
   REDIS_URL=redis://:loadtest@localhost:6380
   NODE_ENV=staging
   DEMO_PROVIDER_ENABLED=false

   GITSLOTPARK_AGENT_ID=AGENT_LOAD_TEST
   GITSLOTPARK_API_TOKEN=load_test_api_token
   GITSLOTPARK_SECRET_KEY=load_test_secret_deterministic_only

   pnpm db:migrate deploy   # baseline + любые новые миграции
   pnpm --filter @casino/api dev
   ```

2. **Создать тестового игрока + game session**. Прямо в БД:

   ```sql
   -- 1. Создать user (или взять существующего)
   INSERT INTO users (id, email, password_hash, status, role, kyc_status, created_at, updated_at)
   VALUES (
     '00000000-0000-0000-0000-000000000001',
     'loadtest@casino.local',
     '$argon2id$...' /* любой валидный хеш */,
     'active', 'user', 'verified', now(), now()
   );

   -- 2. Создать wallet с балансом 100000.00 RUB
   INSERT INTO wallet_accounts (id, user_id, currency, balance, locked, version, created_at, updated_at)
   VALUES (
     '11111111-1111-1111-1111-111111111111',
     '00000000-0000-0000-0000-000000000001',
     'RUB', '100000.00', '0.00', 1, now(), now()
   );

   -- 3. Узнать provider.id для slug='gitslotpark' (нужен для round/transactions)
   SELECT id FROM game_providers WHERE slug = 'gitslotpark';

   -- 4. Создать game_session с playerToken='uid:00000000-0000-0000-0000-000000000001'
   INSERT INTO game_sessions (id, user_id, currency, status, operator_session, created_at, updated_at)
   VALUES (
     '22222222-2222-2222-2222-222222222222',
     '00000000-0000-0000-0000-000000000001',
     'RUB', 'active',
     'uid:00000000-0000-0000-0000-000000000001',
     now(), now()
   );
   ```

   Или через admin-эндпоинт `POST /admin/games/sessions` (если есть) — единый путь через API.

3. **Экспортировать переменные окружения для k6:**

   ```bash
   export USER_ID='00000000-0000-0000-0000-000000000001'
   export GITSLOTPARK_AGENT_ID='AGENT_LOAD_TEST'
   export GITSLOTPARK_SECRET_KEY='load_test_secret_deterministic_only'
   export CURRENCY='RUB'
   export API_URL='http://localhost:3001'
   ```

### Запуск

```bash
# Базовый прогон
k6 run infra/load-tests/wallet-concurrency.js

# С сохранением результатов в JSON для отчёта
k6 run --out json=results/2026-09-03-wallet.json infra/load-tests/wallet-concurrency.js

# Увеличить VU (если 100 — мало)
k6 run --vus 200 --duration 60s infra/load-tests/wallet-concurrency.js
```

### Отчёт

По конвенции `docs/archive/audit-<дата>.md` создаётся `docs/archive/load-test-<дата>.md` с:

- Дата, окружение (CPU/RAM/БД-версия, connection-pool size).
- Профиль (ступени, VU, длительность).
- p50/p95/p99 латентности `http_req_duration`.
- Доля HTTP-ошибок (`http_req_failed`).
- Сколько раз встретился `status=11` (DUPLICATE_TRANSACTION) — индикатор исчерпания optimistic-lock.
- Баланс игрока до/после (`SELECT balance FROM wallet_accounts WHERE user_id = ...`) — если отличается от ожидаемого, это double-spend или потеря ставки.
- **Вывод**: достаточно ли 3 retry-попыток, или нужны advisory-локи / очередь на кошелёк.

Шаблон отчёта — `docs/archive/load-test-TEMPLATE.md`.

## Caveats

- **Не запускать против прод-БД** — к6 завалит баланс игрока. Только изолированный стенд.
- **Не запускать в CI** — нужна поднятая БД, длительность ~3 минуты, риск исчерпания ресурсов runner'а.
- **Не мокать API** — смысл теста в том, чтобы бить реальный endpoint с реальным Postgres + Redis.
