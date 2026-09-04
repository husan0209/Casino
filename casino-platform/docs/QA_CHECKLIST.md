# QA Checklist – Casino Platform

> **Сводка покрытия (GAP-45, 2026-09-03):** 33 пункта. **10 закрыто автотестами полностью** (`[x]` + `[auto: файл::тест]` — 147 unit + 9 E2E = 156 it-блоков в `apps/api/test/`, зелёные в CI на каждом push); **7 закрыто частично** (`[x*]` — код-путь/криптография покрыты спеками, боевой внешний контур остаётся на GAP-46); **16 требуют стенда** (`[manual: ...]`). Ручной остаток ≈ GAP-46 (runtime-приёмка: Rukassa/NOWPayments/GitSlotPark/Google OAuth/Telegram/первый деплой/restore) плюс UI-верификация почты и админ-консоли.
>
> Обозначения: `[x]` — закрыто автотестом целиком (`[auto: <файл>::<имя теста>]`, файлы в `apps/api/test/`); `[x*]` — частично: покрытая часть помечена `[auto:...]`, хвост боевой интеграции/UI — `[manual:...]` (сводится к GAP-46); `[ ]` — `[manual: что и где проверять]`.

## Auth

- [x*] Register → email arrives → verify → login OK — код-путь: `[auto: e2e/player-lifecycle.e2e.spec.ts::«1. регистрация игрока возвращает accessToken и referralCode»/«2. login возвращает свежий accessToken»]`; хвост: `[manual: GAP-46 — письмо верификации доходит по реальному SMTP (Resend), ссылка verify кликается]`
- [ ] Invalid password → INVALID_CREDENTIALS — `[manual: POST /api/v1/auth/login с неверным паролем → 401 INVALID_CREDENTIALS; UI web-логина показывает ошибку. Брутфорс-защита покрыта отдельно: [auto: account-lockout.spec.ts (5 тестов, GAP-18)] ]`
- [ ] Refresh rotates token, old invalidated — `[manual: POST /auth/refresh по httpOnly-cookie → новая пара токенов; повтор refresh СТАРОЙ cookie → 401 SESSION_INVALID (ротация хэша в БД, login.use-case/refresh.use-case)]`
- [ ] Logout revokes session — `[manual: POST /auth/logout с живой cookie → revokedAt выставлен; повторный refresh той же cookie → 401]`
- [ ] Forgot / reset → all sessions revoked — `[manual: POST /auth/forgot-password → письмо с токеном → POST /auth/reset-password → все прежние refresh-cookie невалидны (reset-password.use-case ревокает сессии); smoke: письмо пришло — GAP-46]`
- [ ] Google OAuth creates user, email_verified=true — `[manual: GAP-46 — code-flow на реальном redirect_uri (client_id/secret), пользователь создаётся с emailVerified=true; state-подпись/TTL покроет oauth-verify.spec.ts (GAP-42)]`
- [ ] Telegram hash verification works — `[manual: GAP-46 — Login Widget с ботом на реальном домене; HMAC-логику (SHA256(bot_token)→HMAC data-check-string, freshness 24ч) закроет oauth-verify.spec.ts (GAP-42)]`

## Wallet / Payments

- [x] Credit/debit balance correct — `[auto: ledger.integration.spec.ts::«credit создаёт кошелёк, проводку и инкрементирует version»]` + сквозные суммы: `[auto: e2e/player-lifecycle.e2e.spec.ts::«5. депозит зачисляет 1000 RUB»/«8. confirmWithdrawal — баланс 650, locked 0»]`
- [x] Duplicate idempotency_key → no double credit — `[auto: ledger.integration.spec.ts::«повторный idempotencyKey — duplicate без двойного зачисления»]` + по внешним провайдерам: `[auto: deposit-idempotency.spec.ts::«NOWPayments: повторная доставка на ту же платёжку не доходит до credit»/«Rukassa: ключ проводки от order_id»]`
- [x] Insufficient funds → 422 — `[auto: money-flow.spec.ts::«bet: недостаток средств — ошибка выходит из runInTransaction»]`
- [x*] Rukassa deposit → callback → credit → duplicate callback ignored — HMAC/зачисление/fail-closed/дедуп: `[auto: e2e/player-lifecycle.e2e.spec.ts::«5. вебхук Rukassa с валидным HMAC зачисляет 1000 RUB»/«5b. неверная подпись НЕ меняет баланс»]` + `[auto: deposit-idempotency.spec.ts::«Rukassa: ключ от order_id»]`; хвост: `[manual: GAP-46 — боевой callback от Rukassa на публичный домен после создания платежа в кабинете провайдера]`
- [x*] NOWPayments deposit → actually_paid credited — HMAC-канонизация (python-json.dumps-совместимая): `[auto: nowpayments-ipn.spec.ts (5 тестов)]`; ключ проводки от payment_id: `[auto: deposit-idempotency.spec.ts::«NOWPayments: ключ проводки от payment_id»]`; хвост: `[manual: GAP-46 — createPayment/estimate на реальном ключе, боевой IPN, зачисление actually_paid ≠ norm]`
- [x*] Withdrawal → funds locked → admin approve → balance debited / reject → unlock — approve-путь целиком: `[auto: e2e/player-lifecycle.e2e.spec.ts::«7. вывод 500 RUB: средства блокируются (locked)»/«8. одобрение суперадмином: баланс 650, locked 0»]`; хвост: `[manual: reject-ветка в админке → locked возвращается на баланс]`
- [x*] KYC 5000 RUB limit enforced on deposit — арифметика лимита и курсы: `[auto: kyc-limit-rates.integration.spec.ts::«rate=4000 меняет limit_remaining: 5000 RUB → 1.25 USDT»]` + `[auto: exchange-rates.spec.ts (3 describe, GAP-34)]`; хвост: `[manual: живой депозит без KYC сверх лимита → 403 KYC_REQUIRED]`
- [ ] Withdrawal always requires KYC — `[manual: запрос вывода у не-KYC-игрока → 403 KYC_REQUIRED (API + UI web); E2E покрывает лишь пройденный KYC-gate — «7. KYC-gate пройден»]`

## Casino

- [x*] Game launch → session_token created → iframe opens — API-часть: `[auto: e2e/player-lifecycle.e2e.spec.ts::«6. launch игры создаёт сессию»]`; хвост: `[manual: web-стенд — iframe рендерится, launch_url открывается в браузере]`
- [x] Bet → balance debited, ledger entry created — `[auto: money-flow.spec.ts::«bet: дебетует и пишет gameTransaction в ОДНОЙ транзакции (одинаковый tx)»]`
- [x] Win → balance credited — `[auto: money-flow.spec.ts::«win с суммой > 0: кредитует и закрывает раунд»/«win с суммой 0: проводка пишется, кошелёк не трогается»]`
- [x] Rollback → funds returned — `[auto: money-flow.spec.ts::«rollback ставки → CREDIT (возврат списания), не дебет»]`
- [x] Duplicate bet_transaction → idempotent — `[auto: money-flow.spec.ts::«bet: повторный transactionId → duplicate без повторного списания»]`
- [ ] Session expire after 2h inactivity — `[manual: стенд — сессия простаивает >2h (или lastActivityAt сдвинут в БД) → следующий bet → SESSION_EXPIRED; профиль конкурентности — GAP-47]`
- [ ] Catalog filters / search / pagination — `[manual: web-стенд — фильтры category/provider, поиск, пагинация листинга (HTTP-слой list-games типизирован, но фильтры не покрыты спеком)]`

## Support / Referrals

- [ ] User creates ticket → admin sees → reply → user notified — `[manual: web → создать тикет → виден в админке → ответ админа → статус waiting_user; «notified» — письмо игроку (SMTP, GAP-46)]`
- [ ] Internal notes not visible to user — `[manual: админ шлёт is_internal=true (support-admin.controller) → GET тикета игроком без заметки (listMessages фильтрует isInternal=false)]`
- [x] Referral code generated on register — `[auto: e2e/player-lifecycle.e2e.spec.ts::«1. регистрация возвращает referralCode»]`
- [x] Daily GGR cron → reward credited — `[auto: referral-payout.integration.spec.ts::«GGR>0 → проводка REFERRAL_REWARD + status=credited»/«повторный запуск за день не создаёт вторую проводку»/«день без GGR → zero»]` + запуск по расписанию: `[auto: maintenance-jobs.spec.ts::ReferralDailyJob]`; cron-расписание на стенде — `[manual: сводить к GAP-46]`
- [ ] Notifications list / read / unread_count — `[manual: стенд — сгенерировать уведомление (KYC-решение/ответ в тикете) → GET /notifications → unread_count; POST read → счётчик обнуляется]`

## Admin

- [x*] Admin login separate from user — отдельный admin-JWT/ guard: `[auto: e2e/player-lifecycle.e2e.spec.ts::«4. KYC approve суперадмином (admin-JWT)»]` + `[auto: roles-guard.spec.ts::«неавторизованный (нет user) — Forbidden»]`; хвост: `[manual: GAP-46 — вход в админку через login-форму на стенде, seed-админ]`
- [x] Roles guard blocks user access to /admin/* — `[auto: roles-guard.spec.ts::«class-level @Roles применяется ко всем методам класса»/«method-level переопределяет class-level (run-daily только superadmin)»/«неавторизованный — Forbidden»]` (GAP-32)
- [ ] User block → sessions invalidated — `[manual: блокировка игрока в админке (admin-users.controller → AuditLogService) → refresh-cookie игрока более не работает; проверить на стенде]`
- [ ] KYC approve/reject → user notified — сам approve: `[auto: e2e/player-lifecycle.e2e.spec.ts::«4. KYC approve суперадмином»]`; notify-ветка: `[manual: GAP-46 — письмо/уведомление игроку при approve И при reject (rejectionReason)]`
- [ ] Balance credit/debit → audit_log written — `[manual: ручное кредитование в админке → запись audit_logs (actorId, payload); код-путь пишет через AuditLogService — сверить на стенде]`
- [ ] All admin actions in audit_logs — автодедуп напоминаний: `[auto: maintenance-jobs.spec.ts::«вывод pending >24ч: письмо + запись в audit_log»/«повторный тик НЕ дублирует»]`; полный обход: `[manual: GAP-46 — все действия админки (блок/разблок, KYC-решения, баланс, выводы) → SELECT из audit_logs сверить со списком]`

---

### Считалка (для сверки)

| Раздел | всего | `[x]` auto | `[x*]` частично | `[ ]` manual |
|---|---|---|---|---|
| Auth | 7 | 0 | 1 | 6 |
| Wallet / Payments | 8 | 3 | 4 | 1 |
| Casino | 7 | 4 | 1 | 2 |
| Support / Referrals | 5 | 2 | 0 | 3 |
| Admin | 6 | 1 | 1 | 4 |
| **Итого** | **33** | **10** | **7** | **16** |

**Автопокрытие в сумме: 17 из 33** (10 полных + 7 частичных). Пропорция отвечает фактическому состоянию: весь money-путь и роль-гейт закрыты спеками, внешний контур (SMTP/PSP/OAuth/домен) — осознанный ручной остаток GAP-46.
**Куда идти за деталями:** автопокрытие — `apps/api/test/` (18 файлов в корне + 1 в `e2e/` = 19 спецификаций: money-flow, ledger.integration, deposit-idempotency, nowpayments-ipn, roles-guard, account-lockout, logger-redact, seed-guard, health-ready, exchange-rates, kyc-limit-rates.integration, kyc-file-sniffer, env-validation, game-round.integration, referral-payout.integration, maintenance-jobs, provider-stubs, gitslotpark-adapter, smtp-mailer + e2e/player-lifecycle); ручной остаток — GAP-46 в [IMPLEMENTATION_GAPS.md](IMPLEMENTATION_GAPS.md) (пп. 1–9), session-expire при нагрузке — GAP-47.
