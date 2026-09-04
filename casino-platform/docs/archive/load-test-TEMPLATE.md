# Load Test — Wallet Concurrency (GAP-47) — шаблон отчёта

> Конвенция: `docs/archive/load-test-<YYYY-MM-DD>-<короткое-имя>.md`
> Создаётся после прогона `infra/load-tests/wallet-concurrency.js` на стенде.
> Заполняется владельцем (или AI-агентом после ручного прогона).
> Не заменяет запись в `docs/IMPLEMENTATION_GAPS.md` → GAP-47 (там — одна строка
> «дата + результат», здесь — полный разбор).

---

## Мета

| Поле | Значение |
|------|----------|
| Дата прогона | YYYY-MM-DD |
| Окружение | стенд / prod-like / CI-debug |
| URL | http://... (API_URL) |
| k6 версия | vX.Y.Z (`k6 version`) |
| API commit | `<git rev-parse HEAD>` |
| DB | PostgreSQL X.Y, `version()`, pool size |
| Redis | vX.Y |
| CPU/RAM на API-хосте | N cores, M GB |
| Профиль | 10 → 50 → 100 VU, 30s на ступень (см. infra/load-tests/wallet-concurrency.js) |

## Результаты k6

| Метрика | Значение | Threshold | OK? |
|---------|----------|-----------|-----|
| `http_req_duration` p50 | _мс_ | — | — |
| `http_req_duration` p95 | _мс_ | <500 | ✅/❌ |
| `http_req_duration` p99 | _мс_ | — | — |
| `http_req_failed` rate | _%_ | <1% | ✅/❌ |
| Всего запросов | _N_ | — | — |
| HTTP 200 (status=0, ok) | _N_ | — | — |
| HTTP 200 (status=6, insufficient funds) | _N_ | — | — |
| HTTP 200 (status=11, DUPLICATE_TRANSACTION) | _N_ | **= 0 в идеале** | ✅/❌ |
| HTTP 5xx | _N_ | **= 0** | ✅/❌ |

## Баланс игрока до/после

```sql
-- ДО
SELECT user_id, balance, locked FROM wallet_accounts WHERE user_id = '00000000-0000-0000-0000-000000000001';

-- ПОСЛЕ
SELECT user_id, balance, locked FROM wallet_accounts WHERE user_id = '00000000-0000-0000-0000-000000000001';
```

| Поле | До | После | Ожидание |
|------|----|-------|----------|
| balance | 100000.00 | _?_ | 100000.00 − N × 10.00 (если все ставки прошли) |
| locked | 0.00 | _?_ | 0.00 |

Если баланс **не сходится** — это double-spend или потеря ставки → **P0-блокер запуска**.

## Анализ Optimistic Lock

- Сколько раз встретился `status=11` в логе k6? (см. `grep "status=11" results.json`)
- При какой ступени VU появился первый `status=11`?
- Какая `p95` латентность на этой ступени?

## Вывод

✅ **Достаточно 3 retry-попыток:** тест прошёл все ступени без `status=11`, p95 < 500ms, баланс сошёлся.

❌ **Недостаточно, нужны advisory-локи:** `status=11` появился на VU=N, p95 > 500ms — узкое место в ledger. Рекомендация:

- [ ] `pg_try_advisory_xact_lock(wallet_account_id)` в начале транзакции debit.
- [ ] ИЛИ очередь на кошелёк через BullMQ (1 job на wallet-account).

❌ **Double-spend / потеря ставки:** баланс не сходится. P0-блокер. Немедленно остановить приём ставок, разобрать логи.

## Действия

- [ ] Обновить GAP-47 в `docs/IMPLEMENTATION_GAPS.md` (закрыть или эскалировать).
- [ ] Если меняется retry-стратегия — обновить `apps/api/src/modules/wallet/infrastructure/ledger/wallet.ledger.prisma.ts` и `apps/api/test/ledger.integration.spec.ts`.
- [ ] Если вводится очередь — добавить в `apps/api/src/queues/` (по аналогии с `maintenance.scheduler.ts`).

## Артефакты

- `results/2026-09-03-wallet.json` — вывод k6 (`--out json=...`).
- API-логи за период прогона (Pino, JSON).
- `pg_stat_activity` снапшот во время пика (если снимали).

---

> Шаблон. Не заполнять заранее — копировать и переименовывать в
> `docs/archive/load-test-<YYYY-MM-DD>.md` после прогона.
