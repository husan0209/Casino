# 🚀 Engineering Excellence Plan — Путь к уровню Google / Stripe

> **Статус:** Активный мастер-план  
> **Цель:** Поднять зрелость платформы `casino-platform` до уровня Enterprise (Tier-1 FinTech/iGaming).  
> **Аудитория:** AI-агенты (Claude Code, Cursor, Gemini, Cline), Tech Lead, QA Automation.

---

## 🧭 Навигация по 4 этапам

| Этап       | Направление                      | Целевая метрика               | Инструменты                     |
| ---------- | -------------------------------- | ----------------------------- | ------------------------------- |
| **Этап 1** | **Unit & Use-Case Тестирование** | Покрытие логики **> 85%**     | Vitest, @nestjs/testing         |
| **Этап 2** | **End-to-End (E2E) Сценарии**    | 100% покрытие пути игрока     | Supertest, Playwright           |
| **Этап 3** | **Нагрузочное тестирование**     | 1 000 RPS без race condition  | k6 / Artillery                  |
| **Этап 4** | **Observability & Трассировка**  | Distributed Tracing & Метрики | OpenTelemetry, Prometheus, Pino |

---

## 🧪 Этап 1. Поднятие покрытия тестами до 85%+ (Vitest)

### 1.1. Структура тестов

Тесты располагаются рядом с use-case'ами:
`apps/api/src/modules/<module-name>/application/use-cases/<action>.use-case.spec.ts`

### 1.2. Обязательная матрица Use-Cases для покрытия:

#### 1. Модуль `wallet` (Критичность: 🔴 Максимальная)

- [ ] `wallet.ledger.prisma.ts` / `WalletFacade`:
  - `credit()`: начисление на нулевой баланс, повторный вызов с тем же `idempotencyKey` возвращает `duplicate: true` без повторного начисления.
  - `debit()`: списание при достаточном балансе, выброс `InsufficientFundsError` при нехватке средств.
  - `lock()`: блокировка средств для ставки/вывода, проверка, что `available = balance - locked`.
  - `unlock()`: разблокировка и проверка, что `locked >= 0`.
  - `OptimisticLockError`: проверка отработки retry-механизма (до 3 попыток при параллельных обновлениях `version`).
  - **Деньги:** проверка точности `0.00000001` (8 знаков) — никаких `0.30000000000000004`.

#### 2. Модуль `auth` (Критичность: 🔴 Высокая)

- [ ] `register.use-case.spec.ts`:
  - Успешная регистрация: хеширование пароля (Argon2id), создание реферального кода, генерация verification token.
  - Попытка регистрации на существующий email -> `EmailAlreadyExistsError`.
  - Пароль без цифры или <8 символов -> валидация Zod.
- [ ] `login.use-case.spec.ts`:
  - Неверный пароль -> `InvalidCredentialsError`.
  - Заблокированный пользователь -> `UserBlockedError`.
  - Самоисключенный пользователь -> `SelfExclusionActiveError`.
- [ ] `refresh.use-case.spec.ts`: ротация refresh токена, отзыв сессии при протухшем токене.

#### 3. Модуль `payments` (Критичность: 🔴 Высокая)

- [ ] `process-rukassa-webhook.use-case.spec.ts`:
  - Валидная подпись HMAC-SHA256 -> смена статуса на `completed` + вызов `walletFacade.credit()` со строгим `idempotencyKey`.
  - Невалидная подпись -> `InvalidSignatureError` (кошелек не трогается).
  - Повторный вебхук (replay attack) -> возврат 200 OK без повторного начисления.
- [ ] `process-nowpayments-webhook.use-case.spec.ts`:
  - Зачисление фактической суммы `actually_paid` для крипто-платежей.

#### 4. Модуль `casino` (Критичность: 🟠 Средняя)

- [ ] `game-callback.service.spec.ts`:
  - `bet()`: списание ставки через `walletFacade.debit()`. При нехватке денег возврат `INSUFFICIENT_FUNDS` провайдеру без падения.
  - `win()`: зачисление выигрыша через `walletFacade.credit()`.
  - `rollback()`: отмена ставки и возврат средств на баланс.
- [ ] `launch-game.use-case.spec.ts`: генерация бесшовной сессии игрока.

#### 5. Модуль `referrals` (Критичность: 🟡 Средняя)

- [ ] `referral-calc.service.spec.ts`:
  - Расчет GGR-share: `(bets - wins) * rewardRate`.
  - Если GGR отрицательный — выплата 0, статус `zero`.
  - Если GGR положительный — создание награды и зачисление через `walletFacade.credit()`.

---

## 🔄 Этап 2. End-to-End (E2E) Тестирование

### 2.1. Главный сквозной сценарий (`test/e2e/player-lifecycle.e2e.spec.ts`)

**✅ Реализовано 2026-08-31 (PR #15, 9/9 зелёные в CI):** сервер поднимается как собранный `node dist/main.js` (prod-путь: helmet, pino, rawBody) против тестовых Postgres/Redis; спек — чистый HTTP-клиент (NestFactory внутри vitest-форка крашит процесс). Отличия от исходной схемы: KYC-approve и выплату одобряет суперадмин через admin-JWT (`/admin/auth/login` — `reviewed_by`/audit ссылаются на AdminUser); launch slug — `demo-provider` (фабрика адаптеров, `DEMO_PROVIDER_ENABLED=true`); callback-маршруты `/provider-callback/demo-provider/{bet,win}`. Побочный результат — найдены и закрыты прод-баги: дубликат `MAILER_PORT`, незарегистрированный `OAuthUserProvisioningService`, пустой `HealthModule`, `ZodValidationPipe` валидировал все параметры хендлера, KYC-approve писал user.id в FK AdminUser, `AdminAuthService` не экспортировался.

Тест выполняет полный жизненный цикл:

```
[1. Регистрация игрока]
      ↓ POST /api/v1/auth/register
[2. Авторизация и получение JWT]
      ↓ POST /api/v1/auth/login -> accessToken + refresh_token cookie
[3. Загрузка KYC-документа]
      ↓ POST /api/v1/kyc/documents -> upload с MIME image/png
[4. Депозит через платежный вебхук]
      ↓ POST /api/v1/payments/webhooks/rukassa (с валидным HMAC)
      ↓ Проверка GET /api/v1/wallet/balances -> баланс увеличился на 1000 RUB
[5. Запуск игры]
      ↓ POST /api/v1/casino/games/sweet-bonanza/launch -> game_url + token
[6. Игровой раунд (Seamless Callback)]
      ↓ POST /api/v1/provider-callback/gitslotpark/Bet (ставка 100 RUB) -> баланс 900
      ↓ POST /api/v1/provider-callback/gitslotpark/Win (выигрыш 250 RUB) -> баланс 1150
[7. Заявка на вывод средств]
      ↓ POST /api/v1/payments/withdrawal/fiat (вывод 500 RUB) -> статус pending, locked = 500
[8. Одобрение выплаты админом]
      ↓ POST /api/v1/admin/withdrawals/:id/approve -> confirmWithdrawal() -> баланс 650, locked = 0
```

---

## ⚡ Этап 3. Нагрузочное тестирование (k6 / Artillery)

### 3.1. Цель

Доказать, что при **1 000 одновременных ставок в секунду** на один и тот же аккаунт:

1. Баланс сходится до копейки (`DECIMAL(20,8)`).
2. Нет double-spend (двойного списания).
3. Optimistic Locking корректно обрабатывает конкурентные транзакции без deadlock'ов.

### 3.2. Скрипт нагрузки k6 (`infra/load-tests/wallet-concurrency.js`):

```javascript
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  scenarios: {
    wallet_stress: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 200 }, // Разгон до 200 VU
        { duration: '1m', target: 500 }, // 500 параллельных потоков
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'], // 95% запросов быстрее 200мс
    http_req_failed: ['rate<0.01'], // Ошибок < 1%
  },
}

export default function () {
  const payload = JSON.stringify({
    userId: 'test-user-uuid',
    currency: 'RUB',
    amount: '10.00',
    type: 'BET',
    idempotencyKey: `bet_${__VU}_${__ITER}_${Date.now()}`,
  })

  const res = http.post('http://localhost:3001/api/v1/wallet/debit', payload, {
    headers: { 'Content-Type': 'application/json' },
  })

  check(res, {
    'status is 200 or 400 (insufficient funds)': (r) => r.status === 200 || r.status === 400,
  })
}
```

---

## 📊 Этап 4. Observability, Метрики и Трассировка (Google-Level)

### 4.1. Prometheus Метрики (`@willsoto/nestjs-prometheus`)

Экспортировать на эндпоинт `/metrics`:

1. `casino_http_requests_duration_seconds` (Histogram по routes, status codes).
2. `casino_wallet_operations_total` (Counter по `type`: credit, debit, lock).
3. `casino_active_game_sessions` (Gauge активных сессий).
4. `casino_payment_provider_latency_seconds` (Время ответа Rukassa / NOWPayments).
5. `casino_optimistic_lock_retries_total` (Количество ретраев транзакций БД).

### 4.2. OpenTelemetry Tracing (Jaeger / Grafana Tempo)

- Трассировать каждый входящий HTTP запрос через спаны:
  `HTTP Request` ➔ `Use-Case Execution` ➔ `Prisma Transaction` ➔ `Redis Cache Query`.
- При возникновении ошибки спан помечается красным с записью `error.code` и стектрейса без утечки PII.

### 4.3. Структурированный логгинг (Pino)

- Внедрение единого формата JSON-логов с авто-маскированием секретов:
  ```json
  {
    "level": "info",
    "time": "2026-08-26T18:45:00.000Z",
    "requestId": "c4b12345-6789-4abc-def0",
    "userId": "usr_998877",
    "module": "wallet",
    "action": "credit",
    "amount": "1500.00",
    "currency": "RUB",
    "durationMs": 14.2
  }
  ```

---

## 📋 Инструкция для ИИ-агента, выполняющего эту задачу:

1. **Перед началом работ:**
   - Прочитай `docs/AI_DEVELOPMENT_RULES.md` и `docs/ARCHITECTURE.md`.
   - Не используй `any` в тестах.
   - Тестируй крайние случаи (граничные значения денег `0`, `0.00000001`, отрицательные суммы, дубликаты idempotencyKey).
2. **Порядок выполнения:**
   - Начни с **Этапа 1** (написание unit-тестов на `wallet` и `auth`).
   - Запусти `pnpm test` и убедись, что все тесты зеленые.
   - Переходи к E2E тестам (**Этап 2**).
   - Подключи метрики Prometheus и Pino (**Этап 4**).
3. **Завершение:**
   - Убедись, что `pnpm test:cov` показывает покрытие `Statements > 80%`.
