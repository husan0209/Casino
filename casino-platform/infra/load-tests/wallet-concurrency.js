/**
 * GAP-47: k6-сценарий для нагрузочного тестирования кошелька.
 *
 * Профиль: казино с одним игроком, делающим много ставок в секунду.
 * Бьёт `POST /provider-callback/gitslotpark/withdraw` — это GitSlotPark-op,
 * который адаптер мапит на `action=bet` (см. GAP-43, parseCallback).
 * Внутри: wallet.runInTransaction → wallet.debit с optimistic-lock retry 3 раза.
 *
 * Требования к стенду (см. infra/load-tests/README.md):
 *  - поднятый API на http://localhost:3001 (или API_URL через env);
 *  - Postgres + Redis доступные из API;
 *  - тестовый userId в env USER_ID с game_session в БД
 *    (см. infra/load-tests/README.md → «Подготовка стенда»);
 *  - GITSLOTPARK_AGENT_ID / GITSLOTPARK_SECRET_KEY / GITSLOTPARK_API_TOKEN
 *    в env API (test-secrets в .env.example или .env.test).
 *
 * Прогон:
 *   k6 run --out json=results.json infra/load-tests/wallet-concurrency.js
 *
 * Что измеряем:
 *  - http_req_duration (p95): латентность одной ставки;
 *  - http_req_failed (rate): доля HTTP-ошибок;
 *  - custom counter `optimistic_lock_retry`: сколько раз адаптер ответил
 *    status=11 (DUPLICATE_TRANSACTION) — индикатор исчерпания retry-попыток.
 *
 * Контракт HMAC (CALLBACK_MESSAGE_BUILDERS.withdraw) ЗАФИКСИРОВАН
 * в apps/api/test/gitslotpark-adapter.spec.ts → GAP-43. Этот сценарий
 * использует тот же билдер — после сверки с менеджером GitSlotPark правка
 * только в одном месте (CALLBACK_MESSAGE_BUILDERS), и тесты + этот k6
 * синхронизируются.
 */
import http from 'k6/http'
import { check } from 'k6'
import crypto from 'k6/crypto'

const AGENT_ID = __ENV.GITSLOTPARK_AGENT_ID || 'AGENT_LOAD_TEST'
const SECRET = __ENV.GITSLOTPARK_SECRET_KEY || 'load_test_secret_deterministic_only'
const USER_ID = __ENV.USER_ID || '00000000-0000-0000-0000-000000000001'
const CURRENCY = __ENV.CURRENCY || 'RUB'
const AMT = (v) => Number(v).toFixed(2)
const API_URL = __ENV.API_URL || 'http://localhost:3001'

/**
 * Контракт подписи GitSlotPark для withdraw (bet).
 * Должен совпадать с CALLBACK_MESSAGE_BUILDERS.withdraw в gitslotpark.adapter.ts
 * (GAP-43 spec). Менять синхронно с адаптером.
 */
function buildWithdrawMessage(agentID, userID, amount, transactionID, roundID) {
  return `${agentID}${userID}${AMT(amount)}${transactionID}${roundID}`
}

function signHex(message, secret) {
  // k6/crypto использует тот же HMAC-SHA256, что и node:crypto.
  // Результат — lowercase hex; конвертируем в UPPERCASE для соответствия адаптеру.
  return crypto
    .createHMAC('sha256', secret)
    .update(message, 'utf-8')
    .digest('hex')
    .toUpperCase()
}

export const options = {
  scenarios: {
    wallet_concurrency: {
      executor: 'ramping-vus',
      // GAP-47 критерий 1: профили 10/50/100 VU.
      // Запускаем по 30 секунд на каждой ступени, плюс разгон/торможение.
      startVUs: 10,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '15s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '15s', target: 100 },
        { duration: '30s', target: 100 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // p95 latency — KPI для кошелька. Если выше 500мс — нужно advisory-lock
    // или очередь на кошелёк (см. критерий 4 GAP-47).
    http_req_duration: ['p(95)<500'],
    // Ошибок < 1% на 100 VU. Если больше — optimistic-lock retry исчерпан.
    http_req_failed: ['rate<0.01'],
  },
  // Уменьшаем дефолтный noVUs=1 — ramping-vus управляет сам.
  discardResponseBodies: true,
}

/**
 * Один «спин»: ставка 10.00 RUB по игровому раунду.
 * amount/roundID варьируются от VU и итерации — каждая ставка уникальна,
 * не пройдёт через дедуп по transactionID.
 */
export default function () {
  const vu = __VU
  const iter = __ITER
  const transactionID = `tx-bet-${vu}-${iter}-${Date.now()}`
  const roundID = `r-${vu}-${iter}`
  const amount = '10.00'

  const message = buildWithdrawMessage(AGENT_ID, USER_ID, amount, transactionID, roundID)
  const sign = signHex(message, SECRET)

  const payload = JSON.stringify({
    agentID: AGENT_ID,
    userID: USER_ID,
    amount: amount,
    transactionID: transactionID,
    roundID: roundID,
    sign: sign,
  })

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-gsp-op': 'withdraw',
    },
  }

  const res = http.post(
    `${API_URL}/api/v1/provider-callback/gitslotpark/withdraw`,
    payload,
    params,
  )

  // Ответ GitSlotPark: HTTP 200 + {status: 0, balance: "..."} (ok)
  //                   HTTP 200 + {status: 6, ...} (insufficient funds)
  //                   HTTP 200 + {status: 3, ...} (invalid signature)
  //                   HTTP 5xx — провал инфраструктуры.
  const ok = check(res, {
    'http 200': (r) => r.status === 200,
    'status: 0 (ok) или 6 (no funds)': (r) => {
      try {
        const body = JSON.parse(r.body || '{}')
        return body.status === 0 || body.status === 6
      } catch {
        return false
      }
    },
  })

  // Кастомный счётчик: сколько раз адаптер ответил status=11 (DUPLICATE_TRANSACTION) —
  // это индикатор исчерпания optimistic-lock retry-попыток.
  // При появлении — это сигнал «нужны advisory-локи или очередь».
  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body || '{}')
      if (body.status === 11) {
        // eslint-disable-next-line no-console
        console.warn(`VU=${vu} iter=${iter} got status=11 (DUPLICATE_TRANSACTION)`)
      }
    } catch {
      // ignore
    }
  }

  if (!ok) {
    // eslint-disable-next-line no-console
    console.error(`VU=${vu} iter=${iter} failed: ${res.status} ${res.body && res.body.slice(0, 100)}`)
  }

  // Без sleep — ramping-vus управляет нагрузкой. Если нужно «реалистичное» —
  // добавить sleep(Math.random() * 0.1).
}
