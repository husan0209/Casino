# Casino Platform

Online Casino Platform — NestJS + Next.js + Prisma + PostgreSQL + Redis + BullMQ

СНГ, RUB, Rukassa (фиат), NOWPayments (крипто), KYC 5000₽, GGR-share рефералы 5%

## Stack

Backend: NestJS 10 · TypeScript · Prisma 5 · PostgreSQL 16 · Redis 7 · BullMQ · Zod · argon2
Frontend: Next.js 14 App Router · Tailwind · TanStack Query · Zustand · RHF + Zod
Admin: Next.js + TanStack Table + Recharts

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev
```

API http://localhost:3001/api/v1/health
Web http://localhost:3000
Admin http://localhost:3002

Seed admin: superadmin@casino.example.com / dev_superadmin_password_123

## TZ Progress (ревизия 2026-10-04)

> Единственный источник правды по статусу — `docs/IMPLEMENTATION_GAPS.md` (реестр: GAP-01…GAP-73 +
> TZ-01…TZ-11, 84 позиции; сверка против `origin/main` = `0943477`).
> Снапшот аудита с ревизией каждого пункта — `docs/archive/audit-2026-08-25.md`.
>
> ⚠️ **К запуску не готово. Блокера два, и оба не кодом:**
>
> - **GAP-46** — runtime-приёмка внешнего контура и первый деплой: ни одна внешняя интеграция
>   не общалась с боевым контуром, деплоя не было (нужны `VPS_*`-секреты, домен, боевые ключи
>   Rukassa/NOWPayments/GitSlotPark, SMTP, Turnstile).
> - **GAP-49** — юридика и комплаенс: в `docs/LEGAL_COMPLIANCE.md` §2 все семь чекбоксов пусты
>   (лицензия, тексты, AML-пороги, 152-ФЗ/GDPR, налоги).
>
> Всё остальное из прежних списков блокеров закрыто и сюда не переносится: аудит 2026-09-01
> (GAP-31…GAP-38) закрыт 2026-09-02, аудит #2 (GAP-39…GAP-51) — 2026-09-03…04, GAP-52…GAP-60 —
> 2026-09-13…2026-10-02, GAP-67…GAP-69 — PR #135/#137 (октябрь), **GAP-62 — PR #146** (учётку
> партнёра создаёт и удаляет владелец таблицы `users`, а 2026-10-04 убрана и последняя чужая
> запись партнёрки — `system_settings` пишется через `AdminFacade.setSystemSetting`).
> Открытое **вне** блокеров
> (детали и статусы — в реестре): GAP-03/04/06/07/08/09 (CODE_DONE — нет живого контура),
> GAP-43 (порядок полей подписи GitSlotPark не подтверждён менеджером), GAP-63/GAP-64/TZ-11
> (хвосты ТЗ ч.8), GAP-70 (CVE: 2 critical в `next` до миграции Next 14→15, #140; с #155 в реестре
> виден и dev-контур — 1 critical в vitest, гейт `audit-dev` пока не required), GAP-73 (жизненный
> цикл версий правовых документов), TZ-02 и GAP-66 (решения владельца; исполнение валютного
> набора закрыто кодом в #147/#154/#157 — вне релиза `TON`/`TRX`/`LTC` отклоняется и на депозите,
> и на выводе, а вывод разрешён только в исполнимых валютах).
>
> Инженерные гейты: 5 обязательных чеков CI (`secrets-scan`, `commitlint`, `audit`,
> `lint-typecheck-test`, `docker-build`) + 2 guard'а (`Architecture guards` — G1…G26, `docs-guard` —
> D1…D10, состав сверен по workflow 2026-10-04: `grep -oE 'name: G[0-9]+' | sort -uV`), собираются
> все три прод-образа. Плюс job `audit-dev` (#155) — считается, но в required не заявлен.
> Числа тестов — прогон 2026-10-04 на `0943477` (`pnpm --filter <пакет> exec vitest run`):
> **api 1011** (989 passed + 22 skipped, 129 spec-файлов), **web 210** (25 файлов),
> **admin 25** (4 файла).
>
> **Pre-launch hardening (2026-09-04)**: cleanup-sessions cron (мёртвые сессии), индексы
> game_transactions/ledger_entries (GGR-cron без seq-scan), ротация docker-логов (50m×5),
> graceful shutdown (enableShutdownHooks + stop_grace_period 45s), throttle админ-логина (5/мин),
> ErrorBoundary web/admin, security headers + favicon, OAuth-кнопки в UI (Google/Telegram Widget),
> pnpm-audit в CI + Dependabot.

- [x] Часть 1 Foundation – ~85% – monorepo, Prisma schema (**32 модели + 32 enum** в `packages/database/prisma/schema.prisma`; замер 2026-10-04: `git show origin/main:casino-platform/packages/database/prisma/schema.prisma | grep -c '^model '` — на 03.10 было 31/31, +1 модель и +1 enum добавил журнал акцепта правовых документов (#163)), **5** каталогов миграций (`0_init`, `20260904_pre_launch_gametx_indexes`, две affiliate-миграции и `20261004103227_terms_acceptance_journal` из #163; `migration_lock.toml` — не каталог), **14 модулей API** (`ls apps/api/src/modules`), env-контракт: **104** ключа в `env.validation.ts` (89 `optional()`, 8 с `default()`, 7 обязательных) и **99** активных ключей в `.env.example` — оба числа замерены 2026-10-04 по `origin/main`, shared packages, Docker, Nginx — готово
- [~] Часть 2 Auth/Users/KYC/RBAC – ~90% – регистрация (сразу сессия, TZ-10)/логин/JWT refresh-rotation/KYC 5000₽: остаток лимита из API на странице KYC и в депозитном флоу, CTA на верификацию при исчерпании (GAP-36 закрыт 2026-09-02); BullMQ email queue. Google OAuth (code-flow) и Telegram Login Widget реализованы – живого обмена/логина на домене не было, нужны ключи в env (в реестре GAP-03/04 = `CODE_DONE`, не `CLOSED`)
- [~] Часть 3 Wallet & Payments – ~85% – ledger/optimistic locking + сериализация мутаций кошелька: `pg_advisory_xact_lock` + `ReadCommitted`, повтор ×5 (`wallet-transaction-lock.ts:63,130,143-150`; GAP-57 закрыт 2026-09-30 — раньше было Serializable + retry ×3, см. строку GAP-57 ниже); Rukassa/NOWPayments — реальные HTTP-клиенты и HMAC-verify на raw body (GAP-06/07 в реестре = `CODE_DONE`: код и тесты есть, живой оплаты и боевого IPN не было); runtime — нужны боевые ключи; scheduled jobs на месте (истечение депозитов/курсы/напоминания — GAP-33 закрыт 2026-09-02); курсы из БД/кеша потребляются конвертацией (GAP-34 закрыт 2026-09-02, фиат — политические константы)
- [~] Часть 4 Casino Providers – ~60% – Seamless Wallet API + DemoProvider + GitSlotPark-адаптер (GAP-08 в реестре = `CODE_DONE`, не `CLOSED`: код, адаптер и спек есть — агрегатор Pragmatic Play/PG Soft/Amatic/Amusnet; sync каталога — GAP-09, тоже `CODE_DONE`); до продакшена — сверка sign-порядков (GAP-43 `PARTIAL`) и runtime-тест с ключами
- [x] Часть 5 Frontend Web – ~99% – витрина (last played, бейджи NEW/HOT, лента провайдеров, превью по «i»)/каталог с infinite scroll/избранное/поиск/провайдеры/ЛК (4 вкладки: данные+аватар, безопасность — смена пароля, сессии, настройки)/кошелёк/KYC/история + geo/wallet stores, DepositSheet/LaunchCurrencySheet/WalletSwitcher, play-страница с планкой баланса, SEO (OG/noindex); GAP-52/53 закрыты 2026-09-13; тесты — счёт по spec-файлам (пересчёт 2026-10-04 по `origin/main` = `0943477`; команды: `git ls-tree -r --name-only origin/main -- casino-platform/apps/api/test | grep -cE '\.spec\.ts$'` = 109 и то же по `apps/api/src` = 20): **api 129** (109 + 20 колокейшн), **web 25**, **admin 4** (4-й — `csp.spec.ts`, добавлен #137); всего файлов в `apps/api/test` — 112, три из них не спеки (`affiliate-flow.check.js`, `di-graph.check.js`, `di-inject-audit.js`). На БД требуются **5** из 109 (4 `*.integration.spec.ts` под `LEDGER_INTEGRATION=1` + `e2e/player-lifecycle.e2e.spec.ts` под `E2E_API=1`) — они выполняются только в CI. Число тест-кейсов получено прогоном той же даты (не «на глаз» и не переносом из реестра): **api 1011** (989 passed + 22 skipped), **web 210**, **admin 25** — всего **1246**. Прежние суммы этой строки (57, затем 472/410, 177 web, 11 admin) и `docs/QA_CHECKLIST.md` (403/177/11) разошлись с составом файлов после #131 и #134…#138 и более не цитируются. Десктоп-иконпанель §4.5 (pin/hover), поиск в хедере + Ctrl/⌘K, last played и провайдеры в поиске, auth-страницы без казино-обвязки §4.7 (GAP-54 закрыт 2026-09-14). URL-фильтры каталога + сортировка + сброс, чипы/полки главной (§6.1/§7), ошибки запуска экранами + WithdrawSheet (§8.4/§10.3), история транзакций /wallet/transactions с фильтрами (§11) и история ставок с фильтрами и агрегатами по валютам (§12), performance-хвост §22 (обложки через next/image с allowlist CDN-хостов, ISR главной 60с, dynamic import iframe, content-visibility вместо библиотеки-виртуализации, prefetch по наведению) и bottom-sheet «Фильтры» на телефоне (§7) — закрыто 2026-09-14/15 в GAP-55. Попутно исправлены два неработающих места: фиат-вывод (destination объектом → 422) и snake_case в GameDto (не рендерились бейджи NEW/HOT и кнопка «Демо»). Статус заявки на вывод в истории (§11) закрыт 2026-09-16: заявка получает id до блокировки, проводки несут ссылку, эндпоинт добирает статусы одним запросом (старые строки — null, не выдумываем). Капча после 5 неудач (§5.2) — Cloudflare Turnstile, fail-open при сбое провайдера, порог 5, механизм выключен без обоих ключей; код+13 тестов готовы, живая проверка siteverify — в GAP-46 (нужны ключи и публичный домен). GAP-55 закрыт целиком
- [~] Часть 6 Admin/Support/Referrals – ~70% – Backend API полный (users/finance/support/referrals/notifications+queue/dashboard metrics·charts·events/batch withdrawals). Admin frontend реализован (20 страниц по замеру 2026-10-03 `git ls-tree -r --name-only origin/main -- casino-platform/apps/admin/src | grep -c 'page\.tsx$'`: логин + 13 разделов дашборда — живой дашборд с графиками, users, withdrawals batch, transactions, payments, KYC/support/games/providers/referrals/audit/admins/settings — и 6 страниц партнёрки из ч.8). Два живых дефекта закрыты в октябре: **#135** вернул в `AdminModule` контроллеры настроек и рассылки (`/admin/settings` и `/admin/notifications/send` отдавали 404 при зелёном CI — позиция GAP-67, держат тесты `admin-module-wiring`/`admin-system-services`), **#137** дал админке CSP (GAP-68, `apps/admin/test/csp.spec.ts`). Рефералы: **#141** вынес `ReferralsFacade` и правило В1 «фасад по внешним потребителям», базлайн `cross-module-imports` ужат 7 → 5 (#141) → 3 файла / 4 вхождения (#156: casino перестал тянуть чужой домен и тип) → **0** (2026-10-04: `admin` переведён на `PaymentsFacade` — решение по выводу идёт через новый токен `WITHDRAWAL_REQUEST_STORE` и адаптер в infrastructure, а `UserGeoContext` берётся из домена users). Путь к нулю был закрыт циклом `admin → payments → kyc → admin`: kyc импортировал весь `AdminModule` ради `AdminAuthGuard`; разорван новым `AdminAuthModule` (публичный API `admin` наружу: `AdminFacade`, `AuditLogService`, `AdminAuthModule`). GGR-share выплачивается: cron `referral-daily` + ручной `POST /admin/referrals/run-daily` (GAP-32 закрыт 2026-09-02). Осталось: runtime-проверка с ключами (OAuth, GitSlotPark) на Linux-FS
- [~] Часть 7 DevOps – ~85% – docker-compose.prod, nginx, GitHub Actions CI: 5 чеков (`secrets-scan`, `commitlint`, `audit`, `lint-typecheck-test`, `docker-build`) + deploy-job (после зелёного CI, штатно скипается без VPS-секретов), migrate deploy на деплое (GAP-31), честный readiness + healthcheck на /health/ready (GAP-35), первичная инициализация админа задокументирована + seed fail-closed в production (GAP-38), resource-check.sh (GAP-37). **#137 (позиция GAP-69) починил шесть мест, на которых падала первая же выкатка:** `postgres-backup.sh` убран из `/docker-entrypoint-initdb.d/` (он звал `docker exec` внутри postgres-контейнера), `location /uploads/avatars/` больше не теряет security-заголовки по наследованию (вынесено в сниппет + проверка `infra/scripts/check-nginx-header-inheritance.sh` в CI), у web/admin/nginx появились healthcheck'и и `depends_on: condition: service_healthy` (`up -d` больше не зеленеет при 502), `prisma migrate deploy` вызывается с явным `--schema`, `.env.production` попал под `.gitignore` (+ усилен `check-staged-paths`), а deploy-job без VPS-секретов пишет в summary «выкатки не было» вместо зелёного статуса. **Осталось:** runtime-деплой на VPS с секретами — GAP-46 п.6, в этом репозитории VPS-значений нет
- [~] Часть 8 Affiliate (партнёрская программа) – код есть, приёмки 0% – добавлено 2026-09-29, в этом списке раньше не числилась (позиции GAP-61…GAP-66, TZ-11 в реестре). Модуль `apps/api/src/modules/affiliate/**` (замер 2026-10-04 по `origin/main`: **52 файла** — 51 `*.ts` + `README.md`, 4 слоя + facade, регистрация в `app.module.ts`), **2** миграции (`20260929171538_affiliate_program_initial`, `20260929172043_affiliate_click_relation`), трекинг-редирект `GET /go/:code`, кабинет партнёра в web (`apps/web/src/app/affiliate`: dashboard/links/commissions/players), **6** страниц админки (`apps/admin/src/app/dashboard/affiliate`), **13** spec-файлов модуля, 3 cron-задачи планировщика maintenance, 13 env-переменных в `.env.example`. **Не закрыто по ТЗ ч.8 «Этап 7 — Интеграция»:** (1) атрибуция не вызывается из `oauth-user-provisioning.service` — партнёр теряется при регистрации через Google/Telegram (вызов есть только из `register.use-case.ts:163`, метод объявлен на строке 68); (2) квалификация идёт суточным прогоном (`QualifyAttributionsUseCase`), а не по событию завершения депозита — само событие не проведено, потому что `payments → affiliate` собрало бы цикл модулей (`affiliate → admin → payments`). На корректность сумм это больше не влияет: с 2026-10-05 (GAP-74) прогон читает депозиты из `payment_requests`, а не из колонки `total_deposit`, которую до этого не заполнял никто, — то есть ни один партнёр не квалифицировался вообще, и при нулевом пороге тоже; (3) нет спеков на `affiliate-daily.job`, `affiliate-tracking.controller`, `affiliate-auth.guard` (есть на use-case'ы). Плюс открыты: **GAP-62 → закрыт целиком** (учётку партнёра создаёт и удаляет `users` через `UsersFacade.provisionAffiliatePlayer`/`deprovisionAffiliatePlayer`, а `system_settings` с 2026-10-04 пишется через `AdminFacade.setSystemSetting` — последней чужой записи в модуле не осталось; из межмодульного в affiliate только чтения денег под ADR GAP-51), **GAP-63** (антифрод F4 «депозит ровно на порог» не реализован), **GAP-64** (критерии приёмки A1–A25 end-to-end не прогонялись), **TZ-11** (маршрут `/affiliate/stats` против `(cabinet)/dashboard` в коде), **GAP-66** (вопросы владельца Q1–Q4). Ветка **#139** перевела affiliate-мутации из presentation в use-case'ы (В3). Runtime-приёмка — GAP-46 п.10. Статус источника: `docs/tz-part-8-affiliate-program.md` (v1.0 «реализуется», 79 пунктов приёмки отмечены `[x]`, 4 открыты — пересверено 2026-10-03)

> Подробнее см. `docs/IMPLEMENTATION_GAPS.md` (открытые блокеры запуска: GAP-46 runtime-приёмка, GAP-49 юридика) и раздел Money safety ниже.
>
> **GAP-57 закрыт 2026-09-30** — конкурентные мутации одного кошелька сериализованы
> advisory-локом (`pg_advisory_xact_lock` + ReadCommitted): успех ставок на 100 VU
> вырос с 30,6% до **100%**, деньги сошлись, кошельки не блокируют друг друга
> (10 игроков → 165 rps). Отчёт — `docs/archive/load-test-2026-09-30.md`.

## Money safety

- DB: `DECIMAL(20,8)`
- Code: `string` + `decimal.js`
- API: string
- NEVER `number`/`float`
- Idempotency key on every financial op
- Optimistic locking `wallet_accounts.version`, повтор при конфликте ×5 (`MAX_ATTEMPTS`, `wallet-transaction-lock.ts:63`)
- Все money-мутации — одна транзакция на кошелёк: `pg_advisory_xact_lock` + `ReadCommitted` (`wallet-transaction-lock.ts:130,143-150`). Раньше было `Serializable` + retry ×3 — схема изменена по GAP-57 (2026-09-30). Гард G7 был вакуумным (проверял файл, в котором совпадений уже не было) и **переписан 2026-10-03 (#149)**: теперь `scripts/check-wallet-money-invariant.sh` держит 13 инвариантов (наличие примитивы, advisory-лок до первого чтения, ровно один `ReadCommitted` и ноль `Serializable`, `MAX_ATTEMPTS ≥ 2` + `isRetryableConflict`, отсутствие `prisma.$transaction` и записей в кошелёк глобальным клиентом), а G25 (`guard-selftest`) доказывает, что он краснеет на каждой порче

## Payment security (fail-closed)

- **Production**: Requires `RUKASSA_SECRET_KEY` + `NOWPAYMENTS_IPN_SECRET` for startup
- **No placeholders in production**: Dev prefixes (`dev_*`, `your_*`, `change_me`) are rejected
- **Demo provider disabled by default**: Requires explicit `DEMO_PROVIDER_ENABLED=true` + dev/staging only
- **Stub verification throws in production**: Prevents accidental acceptance of unverified payments
- **Signature verification**: HMAC-SHA256 (Rukassa), HMAC-SHA512 (NOWPayments), constant-time comparison
- See `docs/SECURITY_BASELINE.md` for detailed threat model

## Docs

`docs/` — 36 markdown-файлов + `docs/archive/` (4 md: снапшот аудита 2026-08-25, два отчёта нагрузки и шаблон отчёта; отдельно `manual-migrations/`) — замер 2026-10-03 `git ls-tree --name-only origin/main:casino-platform/docs | grep -c '\.md$'`. Полная карта — **`docs/INDEX.md`**.
Ключевые: ARCHITECTURE, STACK, API_CONVENTIONS, CONVENTIONS, SECURITY_BASELINE, SECURITY_CHECKLIST (честный статус), SECURITY_FIXES, PAYMENT_OVERVIEW, PROVIDER_INTEGRATION_STRATEGY, ENVIRONMENT_VARIABLES, AI_DEVELOPMENT_RULES, MODULE_BOUNDARIES, MODULE_TEMPLATE, AGENT_INSTRUCTIONS, IMPLEMENTATION_GAPS (GAP-трекер), TECH_DEBT (реестр ratchet-долга G16–G26 + CVE-контур), QUALITY_GATES, BRANCH_PROTECTION, QA_CHECKLIST, DEPLOY, USER_FLOW_FIRST_90_SECONDS + 9 файлов ТЗ (`tz-part-1…8` и `tz-part-5.1` — дизайн)

## Deploy

See `docs/DEPLOY.md` – Hetzner CX41, Docker Compose prod, Let's Encrypt, CI/CD via GitHub Actions SSH.
