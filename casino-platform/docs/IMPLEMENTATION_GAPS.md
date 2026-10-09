# Implementation Gaps — реестр расхождений ТЗ ↔ код

> Точка правды по статусу реализации. Не отмечать пункт «готов», пока он не работает end-to-end.
> Правила ведения — [INDEX.md](INDEX.md) §6.3: закрыл код → обнови строку реестра в том же PR.
> Соседние реестры (не дублируем): [TECH_DEBT.md](TECH_DEBT.md) — долг под храповиками G16–G21 и внутренние
> гэпы соответствия инструкциям (В1–В11); [QUALITY_GATES.md](QUALITY_GATES.md) — гейты и D-чеки;
> [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) — безопасность (гард D4); [LEGAL_COMPLIANCE.md](LEGAL_COMPLIANCE.md) — GAP-49.

## 0. Схема реестра (единый формат; статус кодируется одним механизмом)

Один статус на позицию — колонка `Статус`. Всё остальное (эмодзи, жирный шрифт, зачёркивание `~~`,
слово «закрыт» в тексте, дата в скобках, позиция в таблице) статусом **не является** и служит только
отображением. Прежняя версия файла кодировала статус пятью способами одновременно — из-за этого, например,
строка GAP-39 буквально гласила «🟡 P3 открыт» при закрытом гэпе, закрытие GAP-46 физически лежало внутри
строки GAP-45, а статус GAP-30 уехал в 6-ю ячейку при 5-колоночном заголовке.

**Закрытое перечисление статусов:**

| Статус        | Значение                                                                                                    | Эмодзи (производное) |
| ------------- | ----------------------------------------------------------------------------------------------------------- | -------------------- |
| `CLOSED`      | сделано и подтверждено доказательством из колонки `Подтверждение`; регрессия закрыта гардом/тестом/прогоном | ✅                   |
| `CLOSED_WORD` | числится закрытым, но машинного подтверждения нет (закрыто текстом, ADR-комментарием или чтением кода)      | ⚠️                   |
| `CODE_DONE`   | код есть; приёмка (runtime, внешний контур, браузер) не выполнена                                           | 🟦                   |
| `PARTIAL`     | сделано наполовину или мимо ТЗ                                                                              | 🟡                   |
| `OPEN`        | не сделано                                                                                                  | 🔴                   |
| `HUMAN`       | не кодуется: ждёт решения владельца или внешних условий (ключи, домен, юридика)                             | ⏳                   |
| `ACCEPTED`    | осознанное решение НЕ делать (ADR, вне MVP, фаза 2+)                                                        | ⚖️                   |
| `NOT_GAP`     | расхождение с ТЗ оказалось соответствием ТЗ                                                                 | ⬜                   |
| `UNCHECKED`   | в этой ревизии не проверялось                                                                               | ❓                   |

**Колонки таблицы (стабильные, порядок не меняется, число одинаковое в каждой строке):**

| Колонка         | Содержание                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ID`            | стабильный идентификатор (`GAP-nn`, `TZ-nn`); не переиспользуется и не удаляется — закрытая позиция остаётся в реестре                                                                                        |
| `Статус`        | ровно один токен из перечисления выше                                                                                                                                                                         |
| `При`           | приоритет: `P0` блокер, `P1` высокий, `P2` средний, `P3` низкий, `-` не задавался                                                                                                                             |
| `Блок`          | блок/модуль: `auth`, `wallet`, `payments`, `casino`, `kyc`, `referrals`, `affiliate`, `admin`, `web`, `notifications`, `geo`, `infra`, `docs`, `qa`, `legal`                                                  |
| `Что (кратко)`  | одна строка без форматирования; полное обоснование, критерии приёмки и история — в досье позиции (§6)                                                                                                         |
| `Подтверждение` | доказательство текущего состояния: путь (при необходимости со строкой), имя теста, номер PR/коммита или имя гарда. Пустым не оставляется: нет доказательства — статус `CLOSED_WORD`/`UNCHECKED` и слово `нет` |
| `Покрытие`      | чем регрессия закрыта машиной: `гард:<ID>`, `тест:<файл>`, `прогон:<отчёт>`, `код` (только чтение кода), `словом`, `ничем`                                                                                    |
| `Сверка`        | дата сверки статуса с кодом и способ: `(код)` — пути/строки прочитаны, `(код+тест)` — найден и тест/гард, `(прогон)` — прогон в этой среде, `(не проверено)`                                                  |

**Правила ведения:**

1. Длинное обоснование, история решений и остаток — в досье (§6), не в ячейке таблицы: разросшаяся ячейка
   ломает строку — так потерялись GAP-46 (слился с GAP-45) и GAP-30 (статус уехал за границы заголовка).
2. Закрываешь код — меняешь `Статус` и `Сверка` в той же правке; эмодзи — только производная от статуса.
3. Новый блок аудита получает строки в реестре сразу, а не нумерованный отчёт «дефекты 1…N» под таблицей:
   именно так GAP-56, GAP-58, GAP-59 и GAP-60 не имели собственных ID, и их статус читался только из контекста.
4. Счётчики тестов — только с коммитом-замером (§4); цифра без коммита считается недостоверной.
5. `HUMAN` — честный ответ «это не кодит агент»; вместо выдуманных доменов, дат и имён — явная незаполненность (§3.2).

## 1. Ревизия 2026-10-02 (переход на машиночитаемый реестр)

Сверка против `origin/main` = `89881eb` (последний коммит — #134: G21-спеки для 28 use-case'ов, базлайн
`use-case-specs` обнулён); база ветки `chore/techdebt-docs-sync` — `5d2bd67`. Изменено содержательно, а не
только форматом:

- **Единая схема.** Все позиции (GAP-01…GAP-66, TZ-01…TZ-11) сведены в реестр §2 с одним механизмом статуса.
- **GAP-46** извлечён из строки GAP-45 (в файле было `... || GAP-46 |` одной markdown-строкой) и стал
  самостоятельной записью: главный блокер запуска не парсился и не имел ни статуса, ни критерия в таблице.
- **GAP-59** (аудит проекта 2026-10-01) и **GAP-60** (п.3 «хрупкость и гигиена», коммит `5d2bd67`) из
  нумерованных отчётных таблиц превращены в позиции реестра; текст «дефектов» перенесён в досье без потерь.
- **Добавлены позиции ТЗ ч.8 (партнёрская программа)** — GAP-61…GAP-66 и TZ-11: модуль `affiliate`
  (45 файлов — 44 `*.ts` + `README.md`; замер 2026-10-03 `git ls-tree -r --name-only origin/main --
casino-platform/apps/api/src/modules/affiliate | wc -l`, ранее в этом пункте было проставлено
  неподтверждённое «46»; 2 миграции, 6 admin-страниц, кабинет партнёра, 3 cron-задачи, 13 env-переменных;
  PR #105, #119, #123, #128) в этом реестре не был описан ни разу, хотя ТЗ ч.8 — отдельная часть
  спецификации.
- **Переклассифицировано 22 позиции** (полный список «было → стало» — §3.1) и добавлено 7 новых
  (GAP-61…GAP-66, TZ-11): GAP-13 и GAP-17 закрыты по факту кода (трекер отставал); GAP-16, GAP-43 и GAP-51
  переоткрыты (закрыты словами, факт не соответствует); GAP-11, GAP-12, GAP-15, GAP-37, GAP-56 переведены в
  `CLOSED_WORD` (нет машины); GAP-03, GAP-04, GAP-06, GAP-07, GAP-08, GAP-09 — в `CODE_DONE` (код есть, приёмки нет);
  GAP-39 переведён с «открыт» на `CLOSED` (в ячейке два месяца жил текст «🟡 P3 открыт» при закрытом гэпе);
  GAP-46 и GAP-49 получили статус `HUMAN` вместо размытого «блокер/🔴».
- **Счётчики** (§4) пересчитаны по составу репозитория; прежние противоречили друг другу (шапка: «api 203 +
  9 E2E, web 157, admin 6»; срез GAP-58: «api 195 passed/21 skipped, web 161, admin 11»; README: «api 472»).
- **§3.2 «Требует решения человека»**: GAP-46, GAP-49, GAP-66, GAP-08/43, TZ-02 — с перечнем того, чего
  буквально нет в репозитории (VPS-секретов, подтверждённого домена, заполненных юридических решений,
  подтверждения sign-порядков менеджером GSP).

### 1.1 Ревизия 2026-10-03 — сверка с волной #135…#141

Сверка против `origin/main` = `1abe706` (#138 — В3 users+casino). Дополнительно учтены ветки, которые в
ревью и **ещё не в `main`**: #139 = `origin/refactor/admin-finance-affiliate-support-writes` (`5fdb2fb`),
#140 = `origin/fix/cve-overrides` (`c3220c9`), #141 = `origin/feat/referrals-facade` (`67cc9de`). Их статусы
и счётчики помечены в реестре как «по ветке», потому что на `main` они ещё не легли; `feat/web-ui51-remainder-rescue`
(draft, UI-волна 5.1) не учитывается вовсе — в `main` её нет, и при замерах она не использовалась.

- **Закрыто позициями реестра то, что раньше живало только в описаниях PR**: добавлены GAP-67 (#135 —
  admin-эндпоинты `/admin/settings` и `/admin/notifications/send` отдавали 404, контроллеры не были
  зарегистрированы в `AdminModule`), GAP-68 (#137 — у админки не было CSP вовсе), GAP-69 (#137 — шесть
  дефектов первой выкатки: nginx-заголовки, healthcheck'и, `migrate deploy` без `--schema`,
  `postgres-backup.sh` в `initdb.d`, `.env.production` вне `.gitignore`) — все `CLOSED`; GAP-70 (CVE-долг
  после #140) — `PARTIAL`, потому что 2 critical остаются и закрыться могут только миграцией Next 14→15.
- **GAP-16** (README против кода) — `PARTIAL` → `CLOSED`: правки README выполнены в этой же ветке
  (`chore/techdebt-docs-sync`), счётчики заменены на замеряемые командой, «retry ×3» приведён к ADR GAP-57,
  строка ТЗ ч.8 добавлена. На `main` расходится до мержа этой ветки.
- **GAP-62 остаётся `OPEN`** и уточнён: #139 запись в чужую таблицу `users` НЕ убрал — в шапке
  `apps/api/src/modules/affiliate/infrastructure/player-provisioning.prisma.repository.ts` (ветка #139,
  проверено `git show <ref>:<путь>`) поименованы три метода `UsersFacade`, без которых её не убрать:
  `provisionAffiliatePlayer`, `deprovisionAffiliatePlayer`, опционально `isReferralCodeAvailable`.
- **В3 (записи `prisma.*` из presentation)** — в реестре отдельных строк нет намеренно (это долг под
  храповиками, он ведётся в [TECH_DEBT.md](TECH_DEBT.md); §0 «не дублируем»): #138 — users+casino 11 записей → 0,
  #139 — admin-finance/affiliate/support по той же схеме. Здесь обновлены только перекрёстные ссылки в
  досье GAP-09 и GAP-62.
- **Счётчики §4** пересчитаны по `origin/main` и по веткам ревью (spec-файлы, а не «passed»: прогона
  `pnpm test` в этой среде нет — `node_modules` не установлен, см. §3.4).
- **Гигиена статусов**: проверено, что в §3.2 не осталось позиции со статусом `CLOSED`/`CLOSED_WORD`, и что
  ни одна `CLOSED`-позиция не числится там же (GAP-46, GAP-49, GAP-66, TZ-02 — `HUMAN`, GAP-08/GAP-43 —
  `CODE_DONE`/`PARTIAL`).
- **Что нужно знать мерджу этой ветки:** `sh scripts/docs-guard-local.sh` в этом дереве падает на D2
  («путь не существует») для шести путей: `apps/admin/src/lib/csp.ts`, `apps/admin/src/middleware.ts`,
  `apps/admin/test/csp.spec.ts`, `infra/nginx/snippets/security-headers.conf`,
  `infra/scripts/check-nginx-header-inheritance.sh` (#137) и
  `apps/api/src/modules/casino/application/use-cases/admin-sync-provider-games.use-case.ts` (#138) —
  этих файлов в дереве нет, потому что база этой ветки (`8efcc25`) была актуальна до #137/#138. Ссылки в
  реестре верны против `origin/main`; чтобы D2 был зелёным, ветку надо влить в `main` ≥ `1abe706` (или
  подтянуть `main` в неё), а не переформулировать ссылки. Прочие падения D2 в этом прогоне — из
  `QUALITY_GATES.md` и `SECURITY_CHECKLIST.md` (те же файлы, правит другой агент).

## 2. РЕЕСТР

> 85 позиций (74 GAP + 11 TZ). Распределение статусов на 2026-10-05: `CLOSED` — 61, `CODE_DONE` — 9,
> `CLOSED_WORD` — 5, `PARTIAL` — 4, `HUMAN` — 4, `ACCEPTED` — 2, `OPEN` — 0. За два дня сдвиги: GAP-71
> `CLOSED`, GAP-72 `CODE_DONE`, GAP-73 найдена при закрытии GAP-71 и закрыта в той же волне
> (`OPEN` → `CLOSED`), GAP-62 и GAP-74 закрыты кодом и тестами, GAP-63 (F4) закрыт тестами. Позиций `OPEN`
> в реестре больше нет; незакрытое сейчас — `CODE_DONE` (код есть, нет стенда или решения), `CLOSED_WORD`
> (закрытие опирается на текст, не на машину), `PARTIAL` и `HUMAN`.
> Счёт сверен разбором колонки
> `Статус` (§2.1…§2.9), не на глаз: `awk '/^## 2\. РЕЕСТР/,/^## 3\./' docs/IMPLEMENTATION_GAPS.md | grep -E '^\| (GAP|TZ)-[0-9]+ +\|' | awk -F'|' '{gsub(/[ \t]/,"",$3); print $3}' | sort | uniq -c`.
> Ни одна позиция не удалена: закрытые гэпы остаются в таблице как история (колонка `Сверка` показывает,
> когда статус последний раз проверяли против кода).

### 2.1 Первоначальный аудит ТЗ ↔ код (2026-08-23/24) — GAP-01…GAP-17

| ID     | Статус      | При | Блок          | Что (кратко)                                                            | Подтверждение                                                                                                                                                                                                                                                                                                       | Покрытие                                                                                             | Сверка                |
| ------ | ----------- | --- | ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| GAP-01 | CLOSED      | P0  | auth          | Модуль auth был неполным — достроен по контрактам use-case              | `apps/api/src/modules/auth/application/use-cases/register.use-case.ts`                                                                                                                                                                                                                                              | тест:player-lifecycle.e2e                                                                            | 2026-10-02 (код+тест) |
| GAP-02 | CLOSED      | P1  | infra         | BullMQ-очередь email, SMTP-мейлер, rich HTML, воркер в своём процессе   | `apps/api/src/queues/infrastructure/smtp.mailer.ts:94`, `apps/api/src/worker.ts`                                                                                                                                                                                                                                    | тест:email-html-templates                                                                            | 2026-10-02 (код+тест) |
| GAP-03 | CODE_DONE   | P1  | auth          | Google OAuth code-flow: код и тесты есть, live-обмен не проверялся      | `apps/api/src/modules/auth/application/use-cases/oauth/google-oauth.use-case.ts`                                                                                                                                                                                                                                    | тест:oauth-verify                                                                                    | 2026-10-02 (код+тест) |
| GAP-04 | CODE_DONE   | P1  | auth          | Telegram Login: верификация хэша, живой логин не проверялся             | `apps/api/src/modules/auth/application/use-cases/oauth/telegram-login.use-case.ts`                                                                                                                                                                                                                                  | тест:oauth-verify                                                                                    | 2026-10-02 (код+тест) |
| GAP-05 | CLOSED      | P1  | infra         | Email-отправка: очередь + мейлер + fail-closed без SMTP_HOST            | `apps/api/src/queues/infrastructure/smtp.mailer.ts:67-70`                                                                                                                                                                                                                                                           | тест:smtp-mailer                                                                                     | 2026-10-02 (код+тест) |
| GAP-06 | CODE_DONE   | P1  | payments      | Rukassa: реальный HTTP + HMAC вебхука; боевых ключей не было            | `apps/api/src/modules/payments/infrastructure/clients/rukassa.client.ts`                                                                                                                                                                                                                                            | тест:deposit-idempotency                                                                             | 2026-10-02 (код+тест) |
| GAP-07 | CODE_DONE   | P1  | payments      | NOWPayments: payment/estimate/IPN; живой IPN не получен                 | `apps/api/src/modules/payments/infrastructure/clients/nowpayments.client.ts`                                                                                                                                                                                                                                        | тест:nowpayments-ipn                                                                                 | 2026-10-02 (код+тест) |
| GAP-08 | CODE_DONE   | P1  | casino        | GitSlotPark-адаптер (4 бренда); порядки sign не подтверждены менеджером | `apps/api/src/modules/casino/infrastructure/providers/gitslotpark/gitslotpark.adapter.ts`                                                                                                                                                                                                                           | тест:gitslotpark-adapter                                                                             | 2026-10-02 (код+тест) |
| GAP-09 | CODE_DONE   | P2  | casino        | Admin syncGames: реальный fetchGameList + upsert; live-провайдера нет   | `apps/api/src/modules/casino/application/use-cases/admin-sync-provider-games.use-case.ts` (logика вынесена из контроллера в #138)                                                                                                                                                                                   | тест:gitslotpark-adapter (косвенно), тест:casino-admin-sync-provider-games                           | 2026-10-03 (код+тест) |
| GAP-10 | CLOSED      | P1  | admin         | Фронт админки: живые страницы вместо заглушек                           | `apps/admin/src/app/dashboard/affiliate/page.tsx` (и остальные разделы)                                                                                                                                                                                                                                             | тест:api-get-full                                                                                    | 2026-10-02 (код+тест) |
| GAP-11 | CLOSED_WORD | P2  | admin         | API метрик дашборда (metrics/charts/events), raw SQL                    | `apps/api/src/modules/admin/application/dashboard.service.ts`                                                                                                                                                                                                                                                       | ничем                                                                                                | 2026-10-02 (код)      |
| GAP-12 | CLOSED_WORD | P2  | admin         | Batch approve/reject выводов                                            | `apps/api/src/modules/admin/presentation/controllers/admin-finance.controller.ts:333,365` (на `origin/main`); с #139 цикл batch вызывает use-case'ы `approve-withdrawal`/`reject-withdrawal`                                                                                                                        | тест:admin-approve-withdrawal, тест:admin-reject-withdrawal (покрыли use-case, сам учёт batch — нет) | 2026-10-03 (код+тест) |
| GAP-13 | CLOSED      | P1  | referrals     | Начисления `runDaily` запускаются cron-задачей и admin-эндпоинтом       | `apps/api/src/modules/maintenance/application/referral-daily.job.ts:21`                                                                                                                                                                                                                                             | тест:referral-payout.integration                                                                     | 2026-10-02 (код+тест) |
| GAP-14 | CLOSED      | P2  | kyc           | `GET /admin/kyc/:id` вместо `{todo:true}` отдаёт профиль и документы    | `apps/api/src/modules/kyc/presentation/controllers/kyc-admin.controller.ts:60`                                                                                                                                                                                                                                      | тест:kyc-status (частично)                                                                           | 2026-10-02 (код)      |
| GAP-15 | CLOSED_WORD | P2  | notifications | Уведомления уважают `user_settings.notificationsEmail`                  | `apps/api/src/modules/notifications/application/notification.service.ts:41`                                                                                                                                                                                                                                         | ничем                                                                                                | 2026-10-02 (код)      |
| GAP-16 | CLOSED      | P3  | docs          | README врал про `[x]` во всех частях ТЗ                                 | README.md в этой ветке (`chore/techdebt-docs-sync`, сверка 2026-10-03): 31 модель + 31 enum, 14 модулей, 104 ключа `env.validation.ts`, «advisory-лок + ReadCommitted, повтор ×5» вместо «retry ×3», блокеры — только GAP-46/GAP-49, строка «Часть 8» добавлена, счётчики тестов — по spec-файлам с командой замера | гард:docs-guard D1/D2 (ссылки и пути), числам машиной не проверяется                                 | 2026-10-03 (код)      |
| GAP-17 | CLOSED      | P2  | web           | KYC-лимит во фронте: `limit_remaining` читается из API                  | `apps/web/src/lib/api/kyc.api.ts:16`, `apps/web/src/app/kyc/page.tsx:155`                                                                                                                                                                                                                                           | тест:kyc-page, deposit-sheet                                                                         | 2026-10-02 (код+тест) |

### 2.2 Аудит 2026-08-25 (ревизия 2026-08-28) — GAP-18…GAP-30

| ID     | Статус | При | Блок     | Что (кратко)                                                                | Подтверждение                                                                                                                                                               | Покрытие                                                              | Сверка                |
| ------ | ------ | --- | -------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------- |
| GAP-18 | CLOSED | P1  | auth     | Account lockout 10 неудач/15 мин → блок 30 мин, enumeration-safe            | `apps/api/test/account-lockout.spec.ts`                                                                                                                                     | тест:account-lockout                                                  | 2026-10-02 (код+тест) |
| GAP-19 | CLOSED | P0  | infra    | Глобальный ThrottlerGuard + отдельный лимит на `/auth/refresh`              | `apps/api/src/app.module.ts:39`                                                                                                                                             | код (гарда нет)                                                       | 2026-10-02 (код)      |
| GAP-20 | CLOSED | P0  | infra    | `helmet()` в bootstrap до парсеров                                          | `apps/api/src/main.ts`                                                                                                                                                      | код (гарда нет)                                                       | 2026-10-02 (код)      |
| GAP-21 | CLOSED | P1  | infra    | Zod на всех клиентских `@Body`, 2 HMAC-exempt задокументированы             | `@Body` без `ZodValidationPipe` только в `payments-webhook.controller.ts` и `provider-callback.controller.ts` (из 30 контроллеров; пересверено на `origin/main` 2026-10-03) | тест:use-case-спеки модулей (базлайн G21 `use-case-specs` = 0 с #134) | 2026-10-03 (код+тест) |
| GAP-22 | CLOSED | P2  | wallet   | 4-слойка wallet: lock/unlock/confirm как use-case, `runCreditDebit` разбит  | `apps/api/src/modules/wallet/application/use-cases/lock-funds.use-case.ts`                                                                                                  | тест:wallet-withdrawal-ops                                            | 2026-10-02 (код+тест) |
| GAP-23 | CLOSED | P1  | infra    | Pino + redact вместо Nest Logger                                            | `apps/api/src/common/logger/logger.options.ts`                                                                                                                              | тест:logger-redact                                                    | 2026-10-02 (код+тест) |
| GAP-24 | CLOSED | P2  | qa       | Покрытие: money flow, идемпотентность, E2E жизненного цикла                 | `apps/api/test/e2e/player-lifecycle.e2e.spec.ts`, `apps/api/test/ledger.integration.spec.ts`                                                                                | тест:money-flow, ledger.integration                                   | 2026-10-02 (код+тест) |
| GAP-25 | CLOSED | P2  | docs     | ESLint-пороги `max-params` error(3), `complexity` error(10)                 | `корневой .eslintrc.js` (framework-imposed исключения — QUALITY_GATES §2.1.1)                                                                                               | гард:G13, тестов нет                                                  | 2026-10-02 (код)      |
| GAP-26 | CLOSED | P3  | infra    | Path-алиасы вместо deep-relative, рантайм-резолвер не нужен                 | `apps/api/package.json:6` — `nest build && tsc-alias -p tsconfig.build.json`                                                                                                | тест:E2E на собранном dist                                            | 2026-10-02 (код)      |
| GAP-27 | CLOSED | P1  | auth     | argon2id с явными параметрами (memoryCost 65536, timeCost 3, parallelism 4) | `apps/api/src/modules/auth/infrastructure/services/password-hasher.service.ts`                                                                                              | код (прямого теста нет)                                               | 2026-10-02 (код)      |
| GAP-28 | CLOSED | P3  | payments | Идемпотентность депозита по `provider` + `external_id`                      | `apps/api/src/modules/payments/application/use-cases/process-nowpayments-webhook.use-case.ts:109`                                                                           | тест:deposit-idempotency                                              | 2026-10-02 (код+тест) |
| GAP-29 | CLOSED | P3  | infra    | `env.validation.ts` покрывает `.env.example` (перезакрыт: детектор D3 врал) | `apps/api/test/env-validation.spec.ts`                                                                                                                                      | гард:D3 + тест:env-validation                                         | 2026-10-02 (код+тест) |
| GAP-30 | CLOSED | P3  | docs     | Длинные методы разбиты, `max-lines-per-function` возвращён к 60             | `корневой .eslintrc.js`:86 (max 60), override `:152` — только Next.js pages                                                                                                 | гард:G14 + гард:G13                                                   | 2026-10-02 (код)      |

### 2.3 Аудит готовности к запуску 2026-09-01 — GAP-31…GAP-38

| ID     | Статус      | При | Блок      | Что (кратко)                                                                          | Подтверждение                                                                                                                                                                                                                                | Покрытие                                               | Сверка                |
| ------ | ----------- | --- | --------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------- |
| GAP-31 | CLOSED      | P0  | infra     | Prisma-миграции: baseline `0_init` + дрейф-чек                                        | `packages/database/prisma/migrations/0_init/migration.sql`, шаг `Verify no schema drift` в ci.yml; применение на деплое — `exec -T api npx prisma migrate deploy --schema=…` (#137, см. GAP-69)                                              | гард:CI-шаг дрейфа + тестов нет                        | 2026-10-03 (код)      |
| GAP-32 | CLOSED      | P0  | referrals | Реферальные начисления: cron + ручной триггер                                         | `apps/api/src/modules/maintenance/presentation/maintenance-admin.controller.ts:53`                                                                                                                                                           | тест:referral-payout.integration                       | 2026-10-02 (код+тест) |
| GAP-33 | CLOSED      | P1  | infra     | Scheduled jobs: BullMQ Job Schedulers, 7 задач                                        | `apps/api/src/queues/infrastructure/maintenance.scheduler.ts`                                                                                                                                                                                | тест:maintenance-jobs                                  | 2026-10-02 (код+тест) |
| GAP-34 | CLOSED      | P1  | geo       | Курсы из кеша/БД с fallback вместо хардкода                                           | `apps/api/src/modules/geo/application/exchange-rates.service.ts`                                                                                                                                                                             | тест:exchange-rates                                    | 2026-10-02 (код+тест) |
| GAP-35 | CLOSED      | P1  | infra     | Честный readiness: БД — 503 fail-closed, Redis — degraded                             | `apps/api/test/health-ready.spec.ts`, healthcheck на `/health/ready` (docker-compose.prod.yml:57-58); web/admin/nginx получили свои healthcheck'и и `depends_on: condition: service_healthy` в #137 (`:111-116,147-150,172-179`, см. GAP-69) | тест:health-ready                                      | 2026-10-03 (код+тест) |
| GAP-36 | CLOSED      | P2  | web       | KYC-лимит виден игроку до отправки формы (снято 2026-10-07: лимита на пополнении нет) | `apps/web/test/deposit-sheet.spec.tsx` (CTA не уводит на /kyc)                                                                                                                                                                               | тест:deposit-sheet, kyc-page                           | 2026-10-02 (код+тест) |
| GAP-37 | CLOSED_WORD | P3  | docs      | DEPLOY.md приведён к фактическому пайплайну                                           | `infra/scripts/resource-check.sh`                                                                                                                                                                                                            | словом (актуальность DEPLOY.md машиной не проверяется) | 2026-10-02 (код)      |
| GAP-38 | CLOSED      | P2  | infra     | Seed админа fail-closed в production                                                  | `packages/database/src/seed-guard.ts`                                                                                                                                                                                                        | тест:seed-guard                                        | 2026-10-02 (код+тест) |

### 2.4 Аудит готовности #2 (2026-09-02) — GAP-39…GAP-51

| ID     | Статус  | При | Блок      | Что (кратко)                                                                                                  | Подтверждение                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Покрытие                                                              | Сверка                    |
| ------ | ------- | --- | --------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------- |
| GAP-39 | CLOSED  | P3  | docs      | ESLint-долг 1171 warning (0 errors) разобран до нуля во всех трёх apps                                        | `apps/api/package.json:10`, `apps/web/package.json:9`, `apps/admin/package.json:9` — все с `--max-warnings=0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | гард:G13 + гейт lint                                                  | 2026-10-02 (код)          |
| GAP-40 | CLOSED  | P1  | infra     | SMTP-пароль: канон `SMTP_PASSWORD` в мейлере, схеме и доке                                                    | `apps/api/src/queues/infrastructure/smtp.mailer.ts:70`, `packages/shared-config/src/env.validation.ts:127`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | тест:smtp-mailer + гард:D3                                            | 2026-10-02 (код+тест)     |
| GAP-41 | CLOSED  | P2  | infra     | Дрейф код↔`.env.example`: переменные описаны, добавлен чек D7                                                 | чек `D7` в `docs-guard.yml`, `scripts/docs-guard-local.sh`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | гард:D7                                                               | 2026-10-02 (код)          |
| GAP-42 | CLOSED  | P2  | auth      | Верификация OAuth-подписей покрыта спеком                                                                     | `apps/api/test/oauth-verify.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | тест:oauth-verify                                                     | 2026-10-02 (код+тест)     |
| GAP-43 | PARTIAL | P2  | casino    | GitSlotPark: контракт подписи зафиксирован тестом, но порядок полей не подтверждён менеджером                 | `apps/api/test/gitslotpark-adapter.spec.ts`, `CALLBACK_MESSAGE_BUILDERS` в адаптере                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | тест:gitslotpark-adapter                                              | 2026-10-02 (код+тест)     |
| GAP-44 | CLOSED  | P3  | web       | Тест-раннер и DOM-спеки во фронтенде                                                                          | 18 spec-файлов в `apps/web/test`, 4 в `apps/admin/test` (4-й — `csp.spec.ts`, #137)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | тест:kyc-page, deposit-sheet, api-get-full                            | 2026-10-02 (код+тест)     |
| GAP-45 | CLOSED  | P3  | qa        | QA_CHECKLIST: карта авто/ручного покрытия                                                                     | `docs/QA_CHECKLIST.md`: 35 пунктов — 10 `[x]`, 9 `[x*]`, 16 `[ ]`, 24 пометки `[auto:`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | словом (сверка чеклиста ручная)                                       | 2026-10-02 (код)          |
| GAP-46 | HUMAN   | P0  | infra     | Внешний контур поднят и проган на живом стенде; не хватает автоматической выкатки и урегулирования через шлюз | Сделано и проверено: инстанс EC2 (`t3.small`, us-east-1), прод-стек через `docker-compose.prod.yml`, имя `spinera.duckdns.org` + TLS Let's Encrypt (без `-k`), `GET /api/v1/health` 200, витрина и админка отдаются, вход через Google завершён владельцем (не экраном Google), депозитные счета NOWPayments выставлялись и минимальные суммы отдавались `422` вместо `502` с сырым JSON, финансовое ядро партнёрки прогнано на РЕАЛЬНОЙ БД (`apps/api/test/affiliate-flow.check.js`, #201: клик → атрибуция → завершённый депозит → квалификация → NGR → начисление на кошелёк → clawback). Не сделано: job `deploy` не исполнялся ни разу (нет секретов `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`; сам код джобы починен #202 — путь, `restart nginx`, проверка здоровья), реальное урегулирование счёта шлюзом (счета создавались, платёж не проводился), SMTP | HUMAN: owner-действия (секреты, боевые ключи платёжки/SMTP), а не код | 2026-10-07 (стенд)        |
| GAP-47 | CLOSED  | P3  | wallet    | Нагрузочный тест кошелька написан и прогнан                                                                   | `infra/load-tests/wallet-concurrency.js`, `docs/archive/load-test-2026-09-27.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | прогон:load-test-2026-09-30.md                                        | 2026-10-02 (не проверено) |
| GAP-48 | CLOSED  | P3  | referrals | Последнее `eslint-disable max-lines-per-function` снято, возврат закрыт гардом                                | гард `G14 — no eslint-disable for max-lines-per-function` (architecture-guards.yml:349)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | гард:G14                                                              | 2026-10-02 (код)          |
| GAP-49 | HUMAN   | P0  | legal     | Юридика и комплаенс: лицензия, реквизиты оператора, AML-пороги, 152-ФЗ/GDPR, ADR, налоги                      | `docs/LEGAL_COMPLIANCE.md` §6 — решения D1…D11 не приняты; тексты `/legal/*` с 2026-10-03 — полные черновики `1.0-черновик` с плейсхолдерами реквизитов (§2 того же файла)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | словом                                                                | 2026-10-03 (код)          |
| GAP-50 | CLOSED  | P2  | infra     | Sentry-агрегатор (вне ТЗ, согласован владельцем), no-op без DSN                                               | `apps/api/test/sentry-options.spec.ts`, `SENTRY_DSN` в `.env.example`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | тест:sentry-options                                                   | 2026-10-02 (код+тест)     |
| GAP-51 | PARTIAL | P3  | referrals | Cross-module чтения (GGR, user/userSettings) узаконены ADR «только чтение»                                    | `apps/api/src/modules/referrals/infrastructure/referral.prisma.repository.ts:29`, `apps/api/src/modules/notifications/infrastructure/notification.prisma.repository.ts:57,64` (оба живы и на `origin/main`, и на ветке #141)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | словом (ADR = комментарии в коде, гарда нет)                          | 2026-10-03 (код)          |

### 2.5 Фронтенд по ТЗ ч.5 (аудит 2026-09-13…16) — GAP-52…GAP-55

| ID     | Статус | При | Блок | Что (кратко)                                                                                       | Подтверждение                                                                    | Покрытие                                        | Сверка                |
| ------ | ------ | --- | ---- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------- |
| GAP-52 | CLOSED | P2  | web  | Разделы ТЗ ч.5: избранное, поиск, вкладки профиля, infinite scroll, бейджи, SEO                    | `apps/web/src/app/favorites/page.tsx`, `apps/web/src/app/search/page.tsx`        | тест:catalog-filters, game-contract             | 2026-10-02 (код+тест) |
| GAP-53 | CLOSED | P3  | web  | Phase 2 фронта: страницы провайдеров, лента, загрузка аватара                                      | `apps/web/src/app/providers/[slug]/page.tsx`                                     | тест:casino-api, users-api                      | 2026-10-02 (код+тест) |
| GAP-54 | CLOSED | P3  | web  | Десктоп-иконпанель, поиск в хедере, Ctrl/⌘K, auth-страницы без обвязки                             | `apps/web/src/components/layout/DesktopNav.tsx`                                  | тест:desktop-nav (13 кейсов)                    | 2026-10-02 (код+тест) |
| GAP-55 | CLOSED | P3  | web  | Остатки ч.5 (а)–(з): URL-фильтры, полки, экраны ошибок, WithdrawSheet, история, performance, капча | `apps/web/src/app/wallet/transactions/page.tsx`, `apps/api/test/captcha.spec.ts` | тест:withdraw, launch-error, thumbnail, captcha | 2026-10-02 (код+тест) |

### 2.6 Преддеплойная инфраструктура, кошельковый лок, контракты фронта, прод-сборки — GAP-56…GAP-60

| ID     | Статус      | При | Блок   | Что (кратко)                                                                         | Подтверждение                                                                                                                                                                                                                                                                 | Покрытие                                                                                        | Сверка                |
| ------ | ----------- | --- | ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| GAP-56 | CLOSED_WORD | P1  | infra  | Дрейф преддеплойной инфраструктуры: 9 дефектов compose/nginx/scripts/док исправлены  | `docker-compose.prod.yml:197-199` (монтирование snippets), `:213-221` (имена томов), `infra/scripts/restore.sh:43,72` (`--dry-run`, `WITH (FORCE)`) — строки актуальны на `origin/main` после #137; следующая партия дефектов того же класса закрыта #137 и вынесена в GAP-69 | гард:check-nginx-header-inheritance.sh (только класс nginx-заголовков), прогона compose не было | 2026-10-03 (код)      |
| GAP-57 | CLOSED      | P1  | wallet | Конкурентные мутации кошелька сериализованы advisory-локом вместо Serializable+retry | `apps/api/src/modules/wallet/infrastructure/ledger/wallet-transaction-lock.ts:130`, `.env.example:160`                                                                                                                                                                        | тест:wallet-transaction-lock + прогон:load-test-2026-09-30                                      | 2026-10-02 (код+тест) |
| GAP-58 | CLOSED      | P1  | admin  | Аудит контрактов фронт↔API: 5 сломанных мест починены                                | `apps/admin/src/lib/api.ts:52-72`, `apps/web/src/stores/auth.ts:101`                                                                                                                                                                                                          | тест:api-get-full, admin-contract, auth-store-hydrate, kyc-page                                 | 2026-10-02 (код+тест) |
| GAP-59 | CLOSED      | P1  | infra  | Аудит проекта: build-arg `NEXT_PUBLIC_API_URL` для admin, дубли спеков, счётчики     | `docker-compose.prod.yml:108` (args у admin), `scripts/check-prod-build-args.sh`                                                                                                                                                                                              | гард:G23 (architecture-guards.yml:432)                                                          | 2026-10-02 (код)      |
| GAP-60 | CLOSED      | P2  | infra  | Хрупкость и гигиена: прод-сборки web/admin, шрифты, базлайны, D3                     | `.github/workflows/ci.yml:206-222` (три прод-образа на PR и main), `apps/web/src/app/layout.tsx:10` (Inter самохостын)                                                                                                                                                        | гард:docker-build + тест:env-validation                                                         | 2026-10-02 (код)      |

### 2.7 Партнёрская программа, ТЗ ч.8 (в реестре не была — добавлена 2026-10-02) — GAP-61…GAP-66

| ID     | Статус    | При | Блок      | Что (кратко)                                                                                                                               | Подтверждение                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Покрытие                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Сверка                                                                                                        |
| ------ | --------- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GAP-61 | CLOSED    | P1  | affiliate | Ядро ч.8 (регистрация, клик, атрибуция, NGR/RevShare, начисление, кабинет, admin-API/UI) реализовано                                       | `apps/api/src/modules/affiliate/affiliate.module.ts`, `packages/database/prisma/migrations/20260929171538_affiliate_program_initial`, PR #105                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | тест:affiliate-cabinet-contract + 12 spec-файлов модуля (замер по `origin/main`) + 3 affiliate-спека в `apps/api/test` на ветке #139                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 2026-10-03 (код+тест)                                                                                         |
| GAP-62 | CLOSED    | P2  | affiliate | Записи в чужие таблицы у affiliate не осталось: `users` (#146) и `system_settings` (этот код); остаются чтения денег — они легальны по ADR | закрыто #146: `user.create`/`user.delete` из affiliate убраны, `users` сам создаёт и удаляет служебную запись через `UsersFacade.provisionAffiliatePlayer` / `deprovisionAffiliatePlayer` (`gap62-provisioning-wiring.spec.ts`). Остаток закрыт 2026-10-04: `affiliate/infrastructure/affiliate-settings.prisma.repository.ts` больше не зовёт `prisma.systemSetting.upsert`, а пишет через `AdminFacade.setSystemSetting` → `AdminSettingsService.upsert` → порт `SYSTEM_SETTING_REPOSITORY`. Владелец таблицы — admin (карта `MODEL_OWNERS`, гард G24), поэтому `category: 'affiliate'` и `type` передаются вызывающим и применяются тоже на update: иначе маршрут через фасад терял бы группировку в админ-UI и тип ключа. Базлайн G24 ужат с 4 файлов / 8 вхождений до 3 / 7 (замер `sh scripts/bin/tech-debt detect foreign-writes`). ЧТЕНИЯ `walletAccount.findMany` / `ledgerEntry.groupBy` (`affiliate.prisma.repository.ts:855,865`) остались и легальны по ADR GAP-51 (read-only межмодульный доступ зафиксирован 2026-09-04), детектор записей их не считает | тесты:gap62-provisioning-wiring.spec.ts (9, из них 3 на запись настроек), gap62-system-setting-owner.spec.ts (3: category/type в payload, отсутствие category без запроса, делегирование фасада). Деньги-чтения уйдут только при выносе модулей в отдельные БД (пересмотр ADR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 2026-10-04 (код+тесты; `grep -rn "systemSetting" apps/api/src/modules/affiliate` — только чтение в `listRaw`) |
| GAP-63 | CLOSED    | P3  | affiliate | Антифрод F4 (депозит ровно на порог) не реализован — правило молча отсутствовало, признак «минималки» ни в какой отчёт не попадал          | Реализовано на квалификации, а не на атрибуции: `deposit-threshold-band.value-object.ts` (`isNearThresholdDeposit`, коридор ±1% от порога, порог 0 отключает правило), `qualify-attributions.use-case.ts` сравнивает с порогом `amount_rub` **первого** депозита (не накопленную сумму: «закинул минималку» и «накопил минималку тремя платежами» — разные сигналы) и пишет причину в `reject_reason`. ТЗ §13.2 называет токен `needs_review`, в enum-справочнике (§11.4) для этого правила зарезервирован `near_threshold_deposit` — он говорит, какое правило сработало, а `needs_review` в справочник не входит. «Не блокировать» выдержано: статус остаётся `qualified`, `reject` не вызывается, суточный расчёт (`listQualifiedForCalc`) фильтрует по статусу и причине в глаза не видит — начисления идут                                                                                                                                                                                                                                                         | тесты: `deposit-threshold-band.spec.ts` (8: ровно порог, коридор с обеих сторон, граница включительна, за границей, порог 0, коридор в десятичных, а не в float), `qualify-attributions.use-case.spec.ts` (23, из них 6 на F4: флаг не мешает квалификации, сравнивается первый платёж а не накопленное, порог 0, NULL `amount_rub`), `affiliate-qualify.write.spec.ts` (4: причина пишется и статус остаётся `qualified`, без флага пишется null, ключ не передан — колонку не трогаем), `affiliate-deposits.read.spec.ts` (4, в том числе `amountRub` в `select`), `affiliate-attribution-review.spec.ts` (4: фильтр `reject_reason` доходит до репозитория, без причины не добавляется, статус+причина вместе, неизвестный код — ошибка схемы, а не пустая страница), `affiliate-cabinet-contract.spec.ts` (+2: флаг партнёру не отдаётся, настоящая причина отказа — отдаётся). Гарда на правило нет; живого партнёрского депозита по-прежнему не было — GAP-46 | 2026-10-05 (код+тесты)                                                                                        |
| GAP-64 | CODE_DONE | P1  | affiliate | Критерии приёмки ч.8 (A1–A25, ТЗ §19) не прогонялись чек-листом; до 2026-10-07 функционального прогона не было вовсе                       | `docs/tz-part-8-affiliate-program.md` §19. Изменилось 2026-10-07: `affiliate-flow.check.js` (а) перестал подделывать квалификацию прямым `UPDATE` и теперь идёт настоящим путём, (б) был неисполним — `setEnv` удалял `REDIS_URL`, который валидатор требует безусловно, отсюда падение до `AppModule`; прогон на реальной БД зелёный (#201). Чек-лист A1–A25 по пунктам всё ещё не разобран: деньги через шлюз (GAP-46) и UI-состояния кабинета (агент B) к нему не относятся                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | тесты юнит/контракт + functional-прогон на реальной БД; A1–A25 не прогнаны                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 2026-10-07 (прогон)                                                                                           |
| GAP-65 | ACCEPTED  | P3  | affiliate | `provider_fee_sum` всегда 0 → NGR завышен на 2–8% (риск R2)                                                                                | `apps/api/src/modules/affiliate/README.md:67` (комиссии провайдеров нет в системе)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | словом (решение MVP, риск зафиксирован в ТЗ §20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 2026-10-02 (код)                                                                                              |
| GAP-66 | HUMAN     | P2  | affiliate | Открытые вопросы владельца Q1–Q4 и риск R1 (блокировка самоисключённых при атрибуции)                                                      | `docs/tz-part-8-affiliate-program.md` §20 «Открытые вопросы к владельцу»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ничем                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-10-02 (код)                                                                                              |

### 2.8 TZ SYNC — расхождения после обновления ТЗ ч.5 (2026-08-23) — TZ-01…TZ-11

| ID    | Статус    | При | Блок      | Что (кратко)                                                                        | Подтверждение                                                                                                                                                                                | Покрытие                                 | Сверка                |
| ----- | --------- | --- | --------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------- |
| TZ-01 | CLOSED    | P1  | geo       | `GET /api/v1/geo/config` — методы по гео/валюте                                     | `apps/api/src/modules/geo/presentation/controllers/geo.controller.ts:14`                                                                                                                     | код                                      | 2026-10-02 (код)      |
| TZ-02 | HUMAN     | P2  | payments  | MVP-валюты: RUB + USDT_TRC20 + BTC; TON/TRX/LTC убраны из релиза                    | `packages/shared-config/src/geo.config.ts:3` (только USDT_TRC20, BTC) против `apps/api/src/modules/payments/infrastructure/clients/nowpayments.client.ts:15-21` (маппит `ton`, `trx`, `ltc`) | ничем                                    | 2026-10-02 (код)      |
| TZ-03 | CLOSED    | P2  | payments  | `last_payment_method` на профиле для сортировки кассы                               | `packages/database/prisma/schema.prisma:130` (колонка есть и в baseline-миграции GAP-31)                                                                                                     | тест (сортировка — UI, см. UI_WAVE 5.1)  | 2026-10-02 (код)      |
| TZ-04 | CLOSED    | P2  | kyc       | KYC API: `limit_remaining` + `?currency=`                                           | `apps/api/src/modules/kyc/presentation/controllers/kyc.controller.ts:55`                                                                                                                     | тест:kyc-status                          | 2026-10-02 (код+тест) |
| TZ-05 | CLOSED    | P1  | payments  | Крипто-депозит: зачисление факта, не exact amount                                   | `apps/api/src/modules/payments/application/use-cases/process-nowpayments-webhook.use-case.ts:100-105`                                                                                        | тест:nowpayments-ipn                     | 2026-10-02 (код+тест) |
| TZ-06 | CLOSED    | P1  | casino    | Launch: `CURRENCY_NOT_SUPPORTED`, кросс-валютный запрет                             | `apps/api/src/modules/casino/application/use-cases/launch-game.use-case.ts`                                                                                                                  | тест:casino-launch-game                  | 2026-10-02 (код+тест) |
| TZ-07 | CLOSED    | P1  | web       | Фронтенд web по ТЗ ч.5                                                              | см. GAP-52…GAP-55                                                                                                                                                                            | тест (см. GAP-52…55)                     | 2026-10-02 (код+тест) |
| TZ-08 | ACCEPTED  | P3  | geo       | Phase 2 фиат UAH/BYN/KZT/UZS: код готов, включение за `fiatLive` и PSP              | `packages/shared-config/src/geo.config.ts:22` (`fiatLive`), профили RU/UA/BY/KZ/UZ с `false`                                                                                                 | словом (решение ТЗ §24)                  | 2026-10-02 (код)      |
| TZ-09 | CODE_DONE | P1  | web       | Приёмка «первые 90 секунд»: гео-пресеты, депозит `currency` + `method`              | `docs/USER_FLOW_FIRST_90_SECONDS.md`, `apps/web/src/components/wallet/DepositSheet.tsx`                                                                                                      | тест:deposit-sheet, прогон по домену нет | 2026-10-02 (код+тест) |
| TZ-10 | CLOSED    | P1  | auth      | Регистрация сразу выдаёт сессию, без email-тупика                                   | `apps/api/src/modules/auth/application/use-cases/register.use-case.ts`                                                                                                                       | тест:auth-register, e2e                  | 2026-10-02 (код+тест) |
| TZ-11 | PARTIAL   | P3  | affiliate | Кабинет партнёра: ТЗ §12.1 обещает `/affiliate/stats`, в коде `(cabinet)/dashboard` | `apps/web/src/app/affiliate/` (dashboard, commissions, players, links, settings); содержательные блоки §12.2 на месте                                                                        | ничем                                    | 2026-10-02 (код)      |

### 2.9 Волна #135…#141 (сверка 2026-10-03) — GAP-67…GAP-70

> Позиции, которых в реестре не было, потому что работа описывалась только в текстах PR. По правилу §0 п.3
> («новый блок аудита получает строки в реестре сразу») они сюда добавлены; колонка `Сверка` помечает,
> считать ли доказательство состоявшимся на `main` или только на ветке ревью.

| ID     | Статус  | При | Блок  | Что (кратко)                                                                                                                                                                                                                                                                                                                                                           | Подтверждение                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Покрытие                                                                                                                                                                                                                                                                                                                                                                                                     | Сверка                                         |
| ------ | ------- | --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| GAP-67 | CLOSED  | P0  | admin | `/admin/settings` и `/admin/notifications/send` отдавали 404: контроллеры и токены сервисов не были подключены к `AdminModule` (зародыш — #121)                                                                                                                                                                                                                        | `apps/api/src/modules/admin/admin.module.ts:34-35,41-48` (регистрация), PR #135 = `b514c39` на `origin/main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | тест:admin-module-wiring.spec.ts (7) + admin-system-services.spec.ts (8)                                                                                                                                                                                                                                                                                                                                     | 2026-10-03 (код+тест)                          |
| GAP-68 | CLOSED  | P1  | admin | У админки не было CSP вовсе — ни middleware, ни заголовков в ADMIN-vhost (самая привилегированная поверхность)                                                                                                                                                                                                                                                         | `apps/admin/src/lib/csp.ts`, `apps/admin/src/middleware.ts`, `infra/nginx/snippets/security-headers.conf`, PR #137 = `fbe980d`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | тест:apps/admin/test/csp.spec.ts (14 проверок, инвариант «CSP ↔ режим рендеринга»)                                                                                                                                                                                                                                                                                                                           | 2026-10-03 (код+тест)                          |
| GAP-69 | CLOSED  | P1  | infra | Дефекты первой выкатки: `postgres-backup.sh` в `initdb.d` валил первый старт БД, `location /uploads/avatars/` терял security-заголовки по наследованию, у web/admin/nginx не было healthcheck (`up -d` зелёнел при 502), `migrate deploy` без `--schema` не находил схему, `.env.production` не попадал под `.gitignore`, job `deploy` красил «успех» без VPS-секретов | `infra/scripts/check-nginx-header-inheritance.sh`, `docker-compose.prod.yml:111-116,147-150,172-179` (healthcheck'и), `casino-platform/.gitignore`, `infra/scripts/deploy.sh` — всё в `fbe980d` (#137)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | гард:check-nginx-header-inheritance.sh (job `lint-typecheck-test`) + тест:csp.spec.ts; живой выкатки не было → остаток в GAP-46 п.6                                                                                                                                                                                                                                                                          | 2026-10-03 (код)                               |
| GAP-70 | PARTIAL | P1  | infra | CVE-долг: 2 critical в `next` (prod) замьючены до миграции Next 14→15; 1 critical в `vitest` (dev-контур) — гейт есть, в required ещё не заявлен                                                                                                                                                                                                                       | ветка #140 + #142 + #145: `tech-debt/pnpm-audit.txt` = `0/0/0/0/0` (prod-контур НУЛЕВОЙ видимый долг, `cat tech-debt/pnpm-audit.txt`), `package.json` ignoreGhsas 50→25→**27** и overrides 2→**8** (multer, brace-expansion, lodash, postcss, qs, body-parser, uuid, `@mapbox/node-pre-gyp>tar`), `apps/web/next.config.js` — `formats: ['image/webp']`, AVIF выключен (поверхность единственного оставшегося критического RCE); механиз мьута починен #140 — храповик читал `metadata.vulnerabilities`, который pnpm не фильтрует. **Новое (#155):** `--prod` не видит dev-дерево, и 19 advisories (1 critical `GHSA-5xrq-8626-4rwp` vitest <3.2.6, 8 high) не проверялись никем — заведён job `audit-dev` + базлайн `tech-debt/pnpm-audit-dev.txt` = `1/8/7/3/0` | гард:job `audit` в ci.yml (`scripts/audit-ratchet.mjs --check`, канарейка полноты отчёта) + job `audit-dev` (тот же храповик с вторым базлайном; в required НЕ заявлен — допуск канарейки для полного отчёта проходит ровно на границе `48−19 ≤ 27+2` и может покраснеть без роста долга). `pnpm audit` в этом дереве прогонялся (prod: advisories=0, metadata=28 — их снимает mute-лист; полное дерево: 19) | 2026-10-04 (код + прогоны #140/#142/#145/#155) |

### 2.10 Юридические тексты ↔ код (ревизия 2026-10-03, волна «Условия использования») — GAP-71…GAP-73

> Черновики `/legal/*` (каталог `apps/web/src/content/legal`) обещают игроку то, что должно исполняться
> кодом: условие, которое нарушает сам оператор, — это нарушение требования «лицензиат обязан соблюдать
> свои условия» (UKGC LCCP 7.1.1), а не перестраховка. Без этих двух позиций текст Условий публиковать
> нельзя. Обоснование и последствия — `docs/LEGAL_COMPLIANCE.md` §5, строки R1 и R2.

| ID     | Статус    | При | Блок      | Что (кратко)                                                                                                                                                                                                                                                                               | Подтверждение                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Покрытие                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Сверка                                                                    |
| ------ | --------- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| GAP-71 | CLOSED    | P0  | legal     | Нет журнала акцепта условий: доказать, какую редакцию принял игрок, невозможно (урок Betfred — инкорпорация и «signposting»)                                                                                                                                                               | Исполняется и подтверждено прогоном: модель `TermsAcceptance` + миграция `packages/database/prisma/migrations/20261004103227_terms_acceptance_journal`, реестр версий `packages/shared-types/src/legal-documents.ts`, поля `accept_terms`/`terms_version` в `apps/api/src/modules/auth/presentation/dto/register.dto.ts`, запись акцепта и отказ устаревшему клиенту в `apps/api/src/modules/auth/application/use-cases/register.use-case.ts`, отпечаток IP вместо сырого адреса в `apps/api/src/modules/auth/infrastructure/repositories/terms-acceptance.repository.prisma.ts`, чтение `GET /auth/terms-acceptances`, `trust proxy` в `apps/api/src/main.ts`, владение моделью заявлено в карте `MODEL_OWNERS` (`scripts/bin/tech-debt`, гард G24). Прогон 2026-10-04 на собственном порту (API на 3010, БД dev): без согласия → 400, версия 0.9 → 422 `TERMS_VERSION_OUTDATED`, с согласием → 201 и две строки в `terms_acceptances` (terms+privacy, `ip_hash` — sha256, не адрес), `GET` вернул журнал; пробы удалены после замера                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | тесты:auth-register.spec.ts (12, из них 3 на согласие), list-terms-acceptances.use-case.spec.ts (3), terms-acceptance.repository.prisma.spec.ts (4), login-sheet.spec.tsx (register с 4-м аргументом) + живой прогон выше                                                                                                                                                                                                                                                                   | 2026-10-04 (код+тесты+прогон)                                             |
| GAP-72 | CODE_DONE | P1  | legal     | Порог пополнений без KYC: одно число для проверки и для UI, и порог должен видеться в момент зачисления, а не только на интент                                                                                                                                                             | Проверка была и раньше (`apps/api/src/modules/kyc/application/use-cases/kyc-check.service.ts` из `create-fiat-deposit.use-case.ts` и `create-crypto-deposit.use-case.ts`), но порог был захардкожен. Снято 2026-10-07: интент депозита больше не спрашивает KYC (`assertCanDeposit` и код `DEPOSIT_LIMIT_EXCEEDED` удалены, Terms → 1.1), порог остался только как риск-лог при зачислении, а `get-kyc-status.use-case.ts` читал `KYC_DEPOSIT_LIMIT_RUB` — при env=10000 UI обещал 10 000, сервер держал 5 000. Теперь: общий источник `apps/api/src/modules/kyc/application/kyc-limits.ts` (оба места читают его; с 2026-10-07 там же `KYC_WITHDRAW_LIMIT_RUB` — порог вывода без верификации), код ответа `DEPOSIT_LIMIT_EXCEEDED` (`apps/api/src/modules/kyc/domain/errors/index.ts`, наследник `KycRequiredError`, чтобы ветка «нужен KYC» не сломалась), и эскалация в момент зачисления: `escalateOverDepositLimit` вызывается из `process-rukassa-webhook.use-case.ts` и `process-nowpayments-webhook.use-case.ts` ПОСЛЕ кредита и AFTER `updateStatus('completed')` — деньги платящему игроку не замораживаются, факт уходит в структурированный warn и не повторяется на реплее вебхука. Дополнено 2026-10-04 (переплата больше не теряется): вебхук пересчитывает `amount_rub` заявки отношением `actually_paid` к запрошенному `pay_amount` — `creditedAmountRub` в `process-nowpayments-webhook.use-case.ts`, запись идёт тем же `updateStatus('completed')` ДО эскалации, поле `amountRub` добавлено в порт `IPaymentRequestRepository`. Агрегат лимита считает те рубли, что легли в кошелёк, а не оценку курса на интенте; если отношения посчитать нельзя (нет оценки, нет `pay_amount`, делитель ноль, сумма не money-строка) — заявка остаётся с исходной оценкой. Остаток: `ADMIN_CREDIT` (проводка кошелька из админки) в базу порога не входит осознанно — это начисление платформы, а не деньги игрока, и вывод заперт `assertCanWithdraw`; включать его в AML-оборот должно решение комплаенса (GAP-49), а не инициатива кода. Смены статуса KYC по-прежнему нет: у `KycStatus` нет состояния «требуется KYC», а kyc-модуль не импортирует notifications (MODULE_BOUNDARIES §4.3) | тесты:kyc-check.service.spec.ts (15), payments-webhook-kyc-escalation.spec.ts (15), payments-process-nowpayments-webhook.spec.ts (17, из них 6 на пересчёт `amount_rub`), deposit-idempotency.spec.ts                                                                                                                                                                                                                                                                                       | 2026-10-04 (код+тесты)                                                    |
| GAP-73 | CLOSED    | P2  | legal     | Жизненный цикл версий после GAP-71: нет архива полных текстов прошлых версий и нет серверного гейта повторного акцепта при входе (Terms §4, §21)                                                                                                                                           | Архив: `docs/legal/versions/1.0/{terms,privacy,cookies,responsible-gaming}.md` + `docs/legal/versions/registry.json` (на каждую пару «версия/документ» — путь, `sha256` байт снимка, `publishedAt`); снимок не может разойтись с тем, что рендерит страница, — `apps/web/test/legal-archive.spec.ts` сверяет заголовки и каждый абзац с React-деревом и хеш с реестром, ловит висячие записи и сиротские снимки. Гейт: `reacceptRequired` в `apps/api/src/modules/auth/application/use-cases/list-terms-acceptances.use-case.ts` (последняя запись `terms` против `LEGAL_DOCUMENT_VERSIONS.terms`), флаг `terms_reaccept_required` на ответе логина и `POST /auth/terms/accept` (`apps/api/src/modules/auth/presentation/controllers/auth.controller.ts`, `accept-terms.use-case.ts`) — акцеп засчитывается только текущей реестром версии, устаревшая даёт 422 `TERMS_VERSION_OUTDATED`; на фронте диалог `apps/web/src/components/legal/TermsReacceptDialog.tsx` с ссылкой на полный текст, без отметки сессия не продолжается. Прогон 2026-10-04 (свой порт 3011, dev-БД): версия в реестре 1.0 → флаг `false`; после повышения на 1.1 → флаг `true`, акцеп «1.0» → 422 с текстом про действующую версию, акцеп «1.1» → флаг снят и в журнале вторая строка (1.0 → 1.1). Пробный аккаунт и строки журнала удалены, лок снят. Не делается сознательно: жёсткая отказка на игровых/кошельковых эндпоинтах до повторного акцепта — гейт держится на входе (флаг + диалог), а не на каждом запросе                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | тесты:legal-archive.spec.ts (9, в т.ч. красный на правку текста без архива), accept-terms.use-case.spec.ts (4), list-terms-acceptances.use-case.spec.ts (4), terms-reaccept-dialog.spec.tsx (4) + живой прогон выше                                                                                                                                                                                                                                                                         | 2026-10-04 (код+тесты+прогон)                                             |
| GAP-74 | CLOSED    | P1  | affiliate | Квалификация партнёрки не могла пройти никогда: `total_deposit` и `first_deposit_at` заполнял только `applyDeposit`, а вызывающего у него не было — событие «депозит завершён» живёт в payments, который не может импортировать affiliate (цикл `payments → affiliate → admin → payments`) | Квалификация переведена на первоисточник: `AffiliateAttributionRepository.sumPlayerDeposits(playerId)` читает `payment_requests` (`type=deposit`, `status=completed`, сумма по `amount_rub` — та же единица, что у порога `affiliate_min_deposit`, и та же строка, которую вебхук пересчитывает по `actually_paid` после GAP-72), `qualify-attributions.use-case.ts` сравнивает с порогом её и пишет накопленное в `total_deposit` / `deposit_count` / `first_deposit_*`. Чтение легально по ADR GAP-51, записей отсюда не делается. Симптом был тихий: при любом ненулевом пороге — 0 квалифицированных, при нулевом тоже 0 (пустой `first_deposit_at`), ошибок и логов нет. `applyDeposit` оставлен как сейм события с явной пометкой, что вызывающего нет — удалить его значило бы потерять форму, под которую событие придёт                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | тесты:qualify-attributions.use-case.spec.ts (20, из них 3 на это: пустые колонки при реальных депозитах квалифицирует, завышенная колонка без депозита не квалифицирует, порог сравнивается с рублёвой суммой из платежей), affiliate-deposits.read.spec.ts (4: условие запроса `type=deposit` + `status=completed`, сумма по `amount_rub`, нет депозитов — второго запроса нет, `completedAt = null` не ломает квалификацию). Живого депозита в партнёрке по-прежнему не было — это GAP-46 | 2026-10-05 (код+тесты)                                                    |
| GAP-75 | CODE_DONE | P2  | auth      | Telegram Mini App: сайт открывается из бота и игрок входит по подписанному initData — без экрана входа; плюс жизнь интерфейса в WebView (frame-ancestors, safe-area, отсутствие новых вкладок). Код и тесты есть, живой клиент Telegram не проверялся                                      | `apps/api/src/modules/auth/application/use-cases/oauth/telegram-webapp-login.use-case.ts` (секрет — HMAC на «WebAppData», НЕ SHA256 от токена как у виджета), `apps/web/src/lib/telegram-webapp-auth.ts`, `apps/web/src/lib/open-game.ts`, `docs/TELEGRAM_MINI_APP.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | тесты:telegram-webapp-verify.spec.ts (11: подделка, просрочка, чужой токен, лишний параметр, кириллица/`+`/`&`/`%` в имени, проверка до БД), apps/web/test/telegram-webapp.spec.tsx (13: silent-вход только в Telegram, один handshake, очистка адреса, откат на обычный вход), apps/web/test/csp.spec.ts (6), apps/web/test/open-game-webview.spec.ts (3); гард G21 (у use-case есть спека)                                                                                                | 2026-10-09 (код+тесты; CLOSED — только после прогона в настоящем клиенте) |

## 3. Производные срезы (собраны из колонки `Статус`; руками не править — правь реестр)

### 3.1 Что изменилось в статусах (было → стало)

| ID                   | Было (в файле до этой ревизии)                                                          | Стало         | Почему                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GAP-03               | ✅ «Реализовано 2026-08-24»                                                             | `CODE_DONE`   | код и спек есть, живого обмена с Google не было — ключей нет                                                                 |
| GAP-04               | ✅ «Реализовано 2026-08-24»                                                             | `CODE_DONE`   | верификация хэша проверена синтетически и на реальном токене (2026-09-09), живого логина на домене не было                   |
| GAP-06               | ✅                                                                                      | `CODE_DONE`   | боевых ключей Rukassa не было                                                                                                |
| GAP-07               | ✅                                                                                      | `CODE_DONE`   | тестовый платёж создан, реальной оплаты и живого IPN не было                                                                 |
| GAP-08               | ✅ «Код готов» + ⚠️                                                                     | `CODE_DONE`   | живой seamless-раунд не играл; sign-порядки не подтверждены (GAP-43, §3.2)                                                   |
| GAP-09               | ✅                                                                                      | `CODE_DONE`   | upsert-логика есть, каталог не синхронизировался с живым провайдером                                                         |
| GAP-11               | ✅ «Исправлено 2026-08-23»                                                              | `CLOSED_WORD` | ни одного теста на metrics/charts/events; доказательство — только чтение кода                                                |
| GAP-12               | ✅                                                                                      | `CLOSED_WORD` | batch-эндпоинты есть, тестов нет                                                                                             |
| GAP-13               | ⚠️ «частично: само зачисление реальное, но `runDaily` никто не вызывает»                | `CLOSED`      | с 2026-09-02 вызывается: cron `referral-daily.job.ts:21` + ручной `maintenance-admin.controller.ts:53`                       |
| GAP-15               | ✅ «Закрыто в рамках GAP-02»                                                            | `CLOSED_WORD` | факт в коде есть, теста на ветку `notificationsEmail` нет                                                                    |
| GAP-16               | ✅ «Исправлено: честные проценты + ссылка сюда»                                         | `PARTIAL`     | README на `89881eb` снова врёт: «Prisma schema (19 таблиц)» при 31 модели, «retry ×3» против advisory-лока                   |
| GAP-17               | ⚠️ «API `limit_remaining` готов, во фронте не используется»                             | `CLOSED`      | фронты читают поле: `kyc.api.ts:16`, `kyc/page.tsx:155`, `DepositSheet.tsx:282`, закрыто спеками                             |
| GAP-30               | статус уехал в 6-ю ячейку при 5-колоночном заголовке                                    | `CLOSED`      | `max-lines-per-function: 60` в силе, подавлений правила нет (гард G14)                                                       |
| GAP-37               | ✅ P3 закрыт                                                                            | `CLOSED_WORD` | актуальность DEPLOY.md ничем не проверяется — это и есть причина, по которой гэп возвращался                                 |
| GAP-39               | в ячейке буквально «🟡 P3 открыт 2026-09-02», закрытие — простынёй под таблицей         | `CLOSED`      | `--max-warnings=0` во всех трёх lint-скриптах + гард G13                                                                     |
| GAP-43               | ✅ P3 закрыт                                                                            | `PARTIAL`     | тест-часть сделана; вторая половина формулировки («порядок полей подписи не подтверждён») — не сделана                       |
| GAP-46               | физической строки не было: запись была вклеена в конец строки GAP-45 и не парсилась     | `HUMAN`       | отдельная позиция реестра + срез §3.2                                                                                        |
| GAP-49               | 🔴 P0 (организационный)                                                                 | `HUMAN`       | LEGAL_COMPLIANCE §2 — чек-лист не заполнен ни по одному пункту                                                               |
| GAP-51               | ✅ P3 закрыт как ПРИНЯТОЕ РЕШЕНИЕ (ADR)                                                 | `PARTIAL`     | критерий «grep пустой» не выполнен (2 чтения остались), ADR расширялся на ЗАПИСИ — см. GAP-62                                |
| GAP-52               | ✅ P2 закрыт                                                                            | `CLOSED`      | страницы и спеки на месте; браузерная приёмка — остаток GAP-46                                                               |
| GAP-53               | ✅ P3 закрыт                                                                            | `CLOSED`      | то же                                                                                                                        |
| GAP-54               | ✅ P3 закрыт (статус был зашифрован в тексте без токена)                                | `CLOSED`      | `DesktopNav.tsx` + `desktop-nav.spec.ts`                                                                                     |
| GAP-55               | ✅ P3 закрыт                                                                            | `CLOSED`      | (а)–(з) покрыты кодом и тестами                                                                                              |
| GAP-56               | ✅ «ЗАКРЫТ: 9 дефектов, каждый уронил бы первый деплой»                                 | `CLOSED_WORD` | все 9 проверены только `bash -n`; живого прогона compose не было; через 4 дня нашёлся 10-й дефект того же класса (GAP-59/60) |
| GAP-57               | ✅ P1 ЗАКРЫТ 2026-09-30                                                                 | `CLOSED`      | статус был подтверждён прогоном и тестом, но был закодирован вне реестра                                                     |
| GAP-58               | статуса не было — «дефекты 1…5» в отчётной таблице                                      | `CLOSED`      | все 5 фиксов на месте и закрыты спеками                                                                                      |
| GAP-59               | в треКере не было позиции (только в `docs/UI_WAVE_5.1.md` и в шапке файла)              | `CLOSED`      | гард G23 + docker-build всех трёх образов; фиксы на месте                                                                    |
| GAP-60               | в треКере не было позиции (коммит `5d2bd67`)                                            | `CLOSED`      | три прод-образа собираются и на PR, Inter самохостын, D3 честно молчит                                                       |
| GAP-45               | ✅ P3 закрыт (со счётчиками 14/10/9, разошедшимися с фактом)                            | `CLOSED`      | счётчики сверены: 35 пунктов, 10/9/16 — срослось с фактом                                                                    |
| TZ-02                | ⚠️ «публичный exchange-rates убран; проверить NOWPayments client» — без ответа 2 месяца | `HUMAN`       | расхождение подтверждено кодом, решение (убрать маппинг или признать фазой 2) — за владельцем                                |
| TZ-05                | ⚠️ «webhook уже uses actually_paid»                                                     | `CLOSED`      | закрыто тестом, а не словами: `nowpayments-ipn.spec.ts` (4 обращения к `actually_paid`)                                      |
| TZ-08                | 📌 «GeoConfig готов, fiatLive=false до PSP»                                             | `ACCEPTED`    | фаза 2 по ТЗ §24 — осознанное решение, а не незакрытый пункт                                                                 |
| TZ-09                | ⚠️ «Backend готов; web flow частично»                                                   | `CODE_DONE`   | код и доки потока есть; прогон «90 секунд» на публичном домене не выполнялся                                                 |
| TZ-01/03/04/06/07/10 | ✅                                                                                      | `CLOSED`      | статус не менялся, добавлены доказательства и даты сверки                                                                    |

**Новые позиции** (раньше не трекались никогда): GAP-61 `CLOSED`, GAP-62 `OPEN`, GAP-63 `OPEN`, GAP-64 `CODE_DONE`,
GAP-65 `ACCEPTED`, GAP-66 `HUMAN`, TZ-11 `PARTIAL`.

**Ревизия 2026-10-03 (было → стало)** — только то, что изменилось после таблицы выше:

| ID     | Было (2026-10-02)                                                         | Стало         | Почему                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-16 | `PARTIAL` — README на `89881eb` врал (19 таблиц, retry ×3, блокеры)       | `CLOSED`      | правка README в этой же ветке: счётчики по команде, ADR GAP-57, блокеры — только GAP-46/GAP-49, строка ТЗ ч.8                                                                                                         |
| GAP-09 | `CODE_DONE` (без ссылки на то, где теперь логика)                         | `CODE_DONE`   | статус прежний (живого провайдера нет), но запись вынесена из контроллера в use-case (#138) — исправлена ссылка                                                                                                       |
| GAP-12 | `CLOSED_WORD`, покрытие `ничем`                                           | `CLOSED_WORD` | batch-цикл вызывает заспеканные use-case'ы (#139); учёт частичного успеха самого batch-эндпоинта по-прежнему без теста                                                                                                |
| GAP-56 | `CLOSED_WORD`, `Подтверждение` со строками compose до #137                | `CLOSED_WORD` | строки compose поехали (#137); класс nginx-заголовков получил гард, остальные дефекты вынесены в GAP-69                                                                                                               |
| GAP-62 | `OPEN`, без указания, что именно нужно                                    | `OPEN`        | уточнено: три метода `UsersFacade` поименованы в шапке файла на ветке #139 — без них запись из affiliate не убрать                                                                                                    |
| GAP-67 | позиции не было (факт жил только в тексте PR #135)                        | `CLOSED`      | admin-404 по `/admin/settings` и `/admin/notifications/send` закрыт регистрацией + двумя спеками                                                                                                                      |
| GAP-68 | позиции не было                                                           | `CLOSED`      | CSP админки (#137) + `csp.spec.ts` (14 проверок)                                                                                                                                                                      |
| GAP-69 | позиции не было                                                           | `CLOSED`      | шесть дефектов первой выкатки (#137), часть класса закрыта гардом `check-nginx-header-inheritance.sh`                                                                                                                 |
| GAP-70 | позиции не было                                                           | `PARTIAL`     | CVE-механизм мьута починен (#140), 23 advisory сняты overrides; остаток — 2 critical в `next` до миграции 14→15                                                                                                       |
| GAP-49 | `HUMAN`, «все семь чекбоксов пусты», тексты `/legal/*` — заглушки         | `HUMAN`       | статус прежний (юрисдикцию решает владелец), но чек-лист расширен до D1…D11 и добавлены тексты-черновики 1.0 (§1)                                                                                                     |
| GAP-71 | `OPEN` — акцепт нигде не фиксируется (найдено при сверке текстов с кодом) | `CLOSED`      | журнал `terms_acceptances` + сверка версии с реестром + отпечаток IP; подтверждено юнитами и живым прогоном регистрации (§2.10)                                                                                       |
| GAP-72 | `OPEN` — «лимит только отображается, сервер не проверяет»                 | `CODE_DONE`   | формулировка была неверна: проверка на интент была и раньше. Закрыто то, что мешало: общий источник порога, свой код ошибки, эскалация при зачислении. Остаток (переплата NOWPayments, ADMIN_CREDIT) — в строке §2.10 |
| GAP-73 | позиции не было (найдено при закрытии GAP-71)                             | `CLOSED`      | архив версий в `docs/legal/versions/` + гейт повторного акцепта на входе (флаг на логине, `POST /auth/terms/accept`, диалог); Terms §4/§21 больше не держатся на обещании                                             |

**Ревизия 2026-10-07 (стенд + партнёрская программа)**:

| ID     | Было                                                                              | Стало       | Почему                                                                                                                                                                                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-46 | `HUMAN`, «не выполнялась ни разу», покрытие `ничем`                               | `HUMAN`     | статус прежний (остались owner-действия), но описание и подтверждение переведены на факт: стенд поднят, домен + TLS работают, вход через Google завершён, финансовое ядро партнёрки прогнано на реальной БД. Остаток поименован: секреты выкатки, урегулирование счёта шлюзом, SMTP                                                         |
| GAP-64 | «прогона нет»                                                                     | `CODE_DONE` | у позиции появился функциональный прогон на реальной БД (#201) — и выяснилось, что до этого он был дважды неисполним и невменяем: квалификация подставлялась `UPDATE`ом, а `setEnv` удалял обязательный `REDIS_URL`. Чек-лист A1–A25 по-прежнему не разобран, поэтому статус не `CLOSED`                                                    |
| GAP-36 | `CLOSED` — «лимит виден игроку до отправки формы» (плашка в кассе + уход на /kyc) | `CLOSED`    | требование снято, а не выполнено: пополнение не ограничено верификацией (решение владельца 2026-10-07). Касса больше не читает `limit_remaining` и не уводит на `/kyc`, красной карточки исчерпания на `/kyc` нет. Держится спеками `deposit-sheet.spec.tsx` и `kyc-page.spec.tsx`                                                          |
| GAP-72 | `CODE_DONE` — порог как основание для отказа на интенте депозита                  | `CODE_DONE` | статус прежний (число всё так же видно игроку в `GET /kyc` и пишется в риск-лог при зачислении), но принуждение снято: `KycCheckService.assertCanDeposit` и код `DEPOSIT_LIMIT_EXCEEDED` удалены, `assertCanWithdraw` остался единственным guard-ом. Формулировка Terms §14 переведена на это же — версия 1.1, снимок 1.0 сохранён в архиве |

> Там же, 2026-10-07: с пополнения снят и **суммовой** потолок. `depositMax` был
> объявлен в `CurrencyLimitsDef`, задан в таблице валют (RUB 500 000 · USDT 50 000 ·
> BTC 2 …), уходил в ответ `/geo/config` и на интенте давал `AMOUNT_TOO_LARGE`. Удалён
> отовсюду, а не сделан необязательным: пустое поле в типе читалось бы как готовое
> место под будущий лимит. Основание то же, что у снятия KYC-порога, — деньги игрока на
> вход не ограничены, предельный контроль стоит на выдаче (`withdrawMin`/`withdrawMax`
>
> - `assertCanWithdraw`). Минимумы пополнения остались, и убирать их нельзя: они
>   принадлежат провайдеру (20 USDT / 0.0003 BTC), и без нашей проверки заявка уезжала бы
>   в 502 с его сырым JSON (#194). **Дневного лимита в коде нет ни на одном направлении** —
>   ни `per-day`, ни суточной кассы; если он нужен, это отдельное число от владельца, а не
>   то, что «сохранилось» после этой правки.

> Третье следствие той же политики (2026-10-07): верификация перестала быть
> условием **любого** вывода и стала условием вывода **сверх порога**.
> `KYC_WITHDRAW_LIMIT_RUB` (5 000 ₽) — суммарный: база — уже выведенное плюс
> замороженное pending-заявками, а не одна заявка, иначе правило обходится десятью
> заявками по 5 000 ₽. Порог объявлен в рублях, поэтому `CreateWithdrawalUseCase`
> передаёт в KYC RUB-эквивалент (USDT/BTC игрок видит в монетах), и с этого же
> расчёта пишет `amount_rub` в заявку — раньше колонку заполняли только депозиты,
> и выводы до этой правки в базу порога попадают переводом по курсу валюты.
> Ответ `GET /kyc/status` переведён на те же поля (`withdraw_*`): поля про лимит
> пополнений удалены, потому что показывать игроку правило, которое уже ничего не
> решает, — это обещание впустую. Terms подняты до
> **1.2** (`docs/legal/versions/1.2/terms.md`, копия 1.1 в архиве не тронута):
> §6/§7/§14 теперь описывают порог, а не «выплата только после KYC». Заявка
> по-прежнему ручная — оператор подтверждает её в админке и ниже порога тоже;
> автоматических выплат в проекте нет (провайдеры payout не исполняют, §4).
>
> Отдельно, чтобы это не искали в коде: `API_CONVENTIONS` §5.3 обещал код
> `WITHDRAW_LIMIT_EXCEEDED` («дневной/месячный лимит») — такого кода и такого
> лимита в `apps/api/src` никогда не было. Строка помечена как нереализованная,
> а не удалена: суточный лимит — решение владельца по числу, а не техника.

> Дефект, который нашёл живой прогон этой же правки (2026-10-07, стенд): экран и
> отказ считали порог от РАЗНЫХ курсов. `GET /kyc/status` переводил остаток по
> боевому курсу из `exchange_rates` (GAP-34, на стенде 85,6 ₽/USDT), а
> `CreateWithdrawalUseCase` — по константе `DISPLAY_RUB_RATES` (92,5). Игрок видел
> «58,39 USDT доступно», вводил 55 и получал `KYC_REQUIRED`, потому что 55 USDT по
> константе = 5 087 ₽. Чинится не «обе стороны на константы» (это тихо убило бы
> GAP-34), а общим источником: `GeoFacade.convertToRubAtLiveRate` рядом с
> `convertRubToDisplay`, и инвариант в `exchange-rates.spec.ts` с ловушкой на
> смешение источников. Урок для будущих порогов: у показанной границы и у отказа
> должен быть один конверт, и проверять это надо прогоном, а не чтением кода.

> Правка 2026-10-07 затрагивает и правовые документы: `terms` переведены на версию 1.1
> (`packages/shared-types/src/legal-documents.ts`), снимок лежит в
> `docs/legal/versions/1.1/terms.md`, запись добавлена в `registry.json`, а копия 1.0
> осталась в архиве — то, что игрок принял под 1.0, не переписывается задним числом.
> Устаревшая версия помечается по существующему механизму (`TermsVersionOutdatedError`,
> `reacceptRequired` в `list-terms-acceptances.use-case.ts`), поэтому повторить согласие
> нужно только тем, кто идёт принимать условия. Текст `docs/tz-part-2-*.md` (ТЗ) не
> правится по договору работ — расхождение отмечено здесь.

> Отдельно, чтобы не повторять ошибочную претензию: в плане работ значилось, что GAP-63 утверждает
> существование ручной квалификации/отказа атрибуций, а таких маршрутов в `affiliate-admin.controller.ts`
> нет. Проверено по реестру и по коду: реестр таких маршрутов **не обещает** — GAP-63 описывает антифрод-
> правило F4 на квалификации и его тесты. Претензия снята как неверная, а не «исправленная»: менять в
> GAP-63 нечего. Класс ошибки тот же, из-за чего реестры в этом проекте пересчитываются, а не читаются:
> вывод по одному имени символа (`applyDeposit` никем не вызывался ⇒ «денежный контур мёртв») оказался
> неверен ровно по той же причине — надо смотреть место решения, а не имя метода.

**Ревизия 2026-10-04…05 (было → стало)** — волна границ (G16/G24) и партнёрские деньги:

| ID     | Было                                                                           | Стало       | Почему                                                                                                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-62 | `PARTIAL` — осталась одна чужая запись (`systemSetting.upsert`)                | `CLOSED`    | запись ушла в `AdminFacade.setSystemSetting` (владелец таблицы — admin), базлайн G24 ужат 4 файла/8 вхождений → 3/7; деньги-чтения остались по ADR GAP-51                                                                                                                                                                          |
| GAP-63 | `OPEN` — правило F4 молча отсутствовало, покрытия «ничем»                      | `CLOSED`    | коридор ±1% от порога живёт в `deposit-threshold-band.value-object.ts`, флаг `near_threshold_deposit` пишется на квалифицированной строке; статус и начисления правило не трогает («не блокировать» по ТЗ). Закрыто 24 тестами: 18 на само правило и 6 на поверхность разбора (фильтр `reject_reason` в админке, кабинет партнёра) |
| GAP-72 | `CODE_DONE` — «переплата NOWPayments в сумму лимита не попадает»               | `CODE_DONE` | статус прежний (живого IPN не было), но недоучёт закрыт: вебхук пересчитывает `amount_rub` по `actually_paid` до эскалации. В остатке — только `ADMIN_CREDIT`, и это решение комплаенса (GAP-49), а не кода                                                                                                                        |
| GAP-74 | позиции не было (найдено при разборе `applyDeposit`: у метода нет вызывающего) | `CLOSED`    | квалификация читает депозиты из `payment_requests`; событие депозита в payments→affiliate по-прежнему не подключено (цикл модулей), но на корректность сумм оно больше не влияет                                                                                                                                                   |

### 3.2 Требует решения человека (не кодуется агентом)

Ни одна из этих позиций не закрывается правкой кода. В репозитории буквально нет того, что требуется:
выдумывать домены, даты, имена менеджеров и юридические решения — запрещено (см. `docs/AI_DEVELOPMENT_RULES.md`).

| ID              | Чего именно нет (проверено в этом дереве, `5d2bd67`/`89881eb`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Кто решает              | Что появится в коде после решения                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GAP-46          | `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY` существуют только как GitHub Secrets в `.github/workflows/ci.yml` (строки 261-275) и читаются deploy-шагом, который легитимно скипается; в `.env.example` их нет и `.env`-файла в дереве нет вовсе; публичный домен не подтверждён (в `docker-compose.prod.yml:90,108` — плейсхолдер `casino.example.com`, в nginx-шаблоне `DOMAIN`/`ADMIN_DOMAIN` обязательны, но значений нет); SMTP_HOST/SMTP_PASSWORD, боевые ключи Rukassa/NOWPayments/GSP, `TURNSTILE_*` ключи — пусты или отсутствуют | владелец                | записи в эту строку по 10 пунктам критерия (досье GAP-46), датированные отчёты в `docs/archive/`                   |
| GAP-08 / GAP-43 | порядки конкатенации sign-строк по 5 операциям GitSlotPark не подтверждены менеджером провайдера; живого раунда не было                                                                                                                                                                                                                                                                                                                                                                                                          | владелец ↔ менеджер GSP | правится только `CALLBACK_MESSAGE_BUILDERS` + спек `gitslotpark-adapter.spec.ts` показывает дельту                 |
| GAP-49          | `docs/LEGAL_COMPLIANCE.md` §2: все семь чекбоксов пусты (юрисдикция и лицензирование, юридически значимые тексты, AML-пороги, возрастная верификация, 152-ФЗ/GDPR, налоги, лицензия на сайте). Тексты `/legal/*` в коде помечены как предварительная графика                                                                                                                                                                                                                                                                     | владелец                | замена текстов на страницах `/legal/*`, лицензия в футере, инженерная задача на возрастной гейт (если потребуется) |
| GAP-66          | ответы на открытые вопросы ТЗ ч.8 §20: Q1 (блокировать ли самоисключённых при атрибуции — риск R1), Q2 (страховой депозит 20% на первые 30 дней), Q3 (минимальная сумма вывода партнёра), Q4 (`provider_fee` при появлении данных)                                                                                                                                                                                                                                                                                               | владелец                | правки `attribute-player.use-case.ts`, настроек в `system_settings` и текстов соглашения                           |
| TZ-02           | решение по currencies: `geo.config.ts` допускает только `USDT_TRC20` и `BTC`, а `nowpayments.client.ts` продолжает маппить `TON`, `TRX`, `LTC`, исключённые из релиза. Убрать маппинг (тогда мёртвый код удалён) или оставить как задел фазы 2 и зафиксировать в ТЗ                                                                                                                                                                                                                                                              | владелец                | либо удаление 3 строк маппинга и теста, либо явная пометка в ТЗ ч.3 и в `PAYMENT_OVERVIEW.md`                      |

Открытые вопросы, которые **не** требуют владельца сейчас (зафиксировано, кодится без решения):
GAP-64 (нужен стенд, но чек-лист приёмки ч.8 можно подготовить кодом), GAP-70 (остаток CVE закрывается
миграцией Next 14→15 — инженерная задача, не решение владельца). Остаток GAP-16 (правка README) выполнен
в этой же ветке `chore/techdebt-docs-sync` — позиция переведена в `CLOSED`; сверка 2026-10-03.
GAP-62 и GAP-63 из этого списка закрыты в волне 2026-10-04…05 (см. ревизию в §3.1).

### 3.3 Чем закрыто: гард / тест / прогон / словом

Позиции, помеченные `CLOSED_WORD` (в реестре: `Покрытие = ничем`, `словом` или `код`), — это те, где
закрытие опирается на текст, а не на машину. Они же — первые кандидаты на возврат при следующей сверке:
история показывает, что такие закрытия дрейфуют молча (GAP-29 был «закрыт» две недели по лживому детектору D3;
GAP-56 закрыли словами, и через 4 дня нашёлся 10-й дефект того же класса).

| Механизм закрытия                  | Позиции                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Комментарий                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| гард (CI)                          | GAP-25/GAP-30 (G13, G14), GAP-29 (D3), GAP-39 (G13), GAP-41 (D7), GAP-48 (G14), GAP-59 (G23), GAP-60 (job docker-build + гарды техдолга), GAP-31 (шаг `Verify no schema drift`), GAP-69 (`check-nginx-header-inheritance.sh` в job `lint-typecheck-test`), GAP-70 (job `audit` + `scripts/audit-ratchet.mjs`, с #140 читает `advisories`, а не `metadata.vulnerabilities`)                                                                                                                                                                                                                 | red-тест на откате фикса есть у G23 (проверялось автором гэпа); у GAP-70 канарейка полноты отчёта → rc=2                                                   |
| тест (vitest)                      | GAP-01, GAP-02, GAP-05, GAP-13, GAP-17, GAP-18, GAP-21, GAP-22, GAP-23, GAP-24, GAP-28, GAP-30, GAP-32…GAP-36, GAP-38, GAP-40, GAP-42, GAP-43 (контракт подписи), GAP-44, GAP-50, GAP-52…GAP-55, GAP-57, GAP-58, GAP-61, GAP-62 (`gap62-*.spec.ts`), GAP-63 (F4, 24 теста: коридор ±1% + флаг на квалификации + запись в `reject_reason` + фильтр разбора в админке + кабинет), GAP-67 (admin-module-wiring + admin-system-services, #135), GAP-68 (`csp.spec.ts`, #137), GAP-74 (`qualify-attributions.use-case.spec.ts` + `affiliate-deposits.read.spec.ts`), TZ-04, TZ-05, TZ-06, TZ-10 | часть из них — юниты, не приёмка; GAP-12 с #139 тоже опирается на спеки use-case'ов, но учёт частичного успеха batch-эндпоинта собственного теста не имеет |
| прогон (отчёт)                     | GAP-47, GAP-57 (`docs/archive/load-test-2026-09-27.md`, `docs/archive/load-test-2026-09-30.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | воспроизводимо только со стендом                                                                                                                           |
| словом / чтением кода (машины нет) | GAP-11, GAP-15, GAP-16 (числа README сверяются командами, но гарда на их актуальность нет), GAP-37, GAP-45, GAP-51, GAP-56, GAP-65, TZ-03 (сортировка кассы — только UI-проверка в стенде), TZ-08, TZ-09                                                                                                                                                                                                                                                                                                                                                                                   | этот список — ответ на вопрос «что реально не защищено от регресса»                                                                                        |
| ничем (позиция открыта)            | GAP-46, GAP-49, GAP-66, TZ-02, TZ-11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —; GAP-62 и GAP-63 из этой строки убраны 2026-10-05, у обоих есть тесты                                                                                    |

### 3.4 Не проверено в этой ревизии (и почему)

| Что                                                                                                                                     | Почему не проверено                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Число **прошедших** тестов (api/web/admin), а также «0 warnings» линтеров                                                               | в этом дереве `node_modules` не устанавливались; `pnpm`-скрипты не запускались. Пересчитан только **состав файлов** (§4)            |
| Зелён ли CI на `origin/main` (`1abe706`) и на ветках #139/#140/#141                                                                     | `gh` CLI в этой среде недоступен, статус прогонов не читался                                                                        |
| Цифры из описаний PR (#137 «тесты админки 25/25», #139 «typecheck/test/tech-debt exit 0», #140 «полный отчёт 2/8/16/3, 586 тестов api») | это заявления авторов в текстах коммитов; в этом дереве ничто из них не перепрогонялось — в реестре они помечены как «по отчёту PR» |
| `docker compose config`/`up` с заполненным `.env` (GAP-56, GAP-69)                                                                      | нет `DOMAIN`/секретов; #137 проверял config только до ошибки отсутствующего `DOMAIN`                                                |
| Повторный прогон k6 (GAP-47/GAP-57)                                                                                                     | нужен Docker-стенд с Postgres/Redis и собранным API                                                                                 |
| Любая браузерная приёмка фронта, живой OAuth/PSP/GSP/SMTP/Turnstile, первый деплой (весь §3.2)                                          | внешний контур: ключи, домен, VPS — у владельца (GAP-46)                                                                            |
| Применимость миграций на живой БД (`migrate deploy`), `restore.sh` на реальном дампе                                                    | нет БД и VPS; `restore.sh` с момента переписывания (GAP-56) не запускался ни разу                                                   |

## 4. Счётчики (пересчёт 2026-10-03 против `origin/main` = `1abe706`; ветки ревью — отдельной колонкой)

Состав файлов — единственное, что считается без `node_modules`. Числа «passed» здесь нет и не будет, пока
не согнан прогон (см. §3.4): пишется **spec-файлов N**, а не «тестов N». Прежний замер этого раздела держался
на `89881eb` (#134) и уже устарел.

| Метрика                          | Значение на `origin/main` (`1abe706`, 2026-10-03)                                                                                                                                                                                                                                                                                      | Значение на ветках ревью                                                                                              | Как считать                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spec-файлов `apps/api`           | **94** = 78 в `apps/api/test` + 16 колокейшн в `apps/api/src`; всего файлов в `apps/api/test` — **81** (ещё 3 не-спеки: `affiliate-flow.check.js`, `di-graph.check.js`, `di-inject-audit.js`); на БД требуются **5** из 78 (4 `*.integration.spec.ts` под `LEDGER_INTEGRATION=1` + `e2e/player-lifecycle.e2e.spec.ts` под `E2E_API=1`) | #139 = **101** (85 + 16); #140 и #141 — **94**, новых спеков не добавляют                                             | `git ls-tree -r --name-only origin/main -- casino-platform/apps/api/test` (`\| wc -l` = 81, `\| grep -cE '\.spec\.ts$'` = 78) + то же по `apps/api/src` |
| spec-файлов `apps/web`           | **18**                                                                                                                                                                                                                                                                                                                                 | 18 (без изменений)                                                                                                    | `git ls-tree -r --name-only origin/main -- casino-platform/apps/web \| grep -cE '\.spec\.(ts\|tsx)$'`                                                   |
| spec-файлов `apps/admin`         | **4** (было 3 на `89881eb`; `csp.spec.ts` добавлен #137)                                                                                                                                                                                                                                                                               | 4 (в #139 — 4)                                                                                                        | то же по `apps/admin`                                                                                                                                   |
| моделей Prisma                   | **31** (+31 `enum`)                                                                                                                                                                                                                                                                                                                    | 31                                                                                                                    | `git show origin/main:casino-platform/packages/database/prisma/schema.prisma \| grep -c '^model '` (аналогично `'^enum '`)                              |
| миграций (каталогов)             | **4** (`0_init`, `20260904_pre_launch_gametx_indexes`, `20260929171538_affiliate_program_initial`, `20260929172043_affiliate_click_relation`)                                                                                                                                                                                          | 4                                                                                                                     | `git ls-tree --name-only origin/main:casino-platform/packages/database/prisma/migrations`                                                               |
| модулей API                      | **14** (`admin`, `affiliate`, `auth`, `casino`, `geo`, `health`, `kyc`, `maintenance`, `notifications`, `payments`, `referrals`, `support`, `users`, `wallet`)                                                                                                                                                                         | 14                                                                                                                    | `git ls-tree --name-only origin/main:casino-platform/apps/api/src/modules`                                                                              |
| ключей в `env.validation.ts`     | **104** в `envSchema`: 89 `optional()`, 8 с `default()`, **7** обязательных (`APP_URL`, `ADMIN_URL`, `DOMAIN`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`)                                                                                                                                                 | 104                                                                                                                   | `git show origin/main:casino-platform/packages/shared-config/src/env.validation.ts \| sed -n '78,242p' \| grep -cE '^    [A-Z][A-Z0-9_]*:'`             |
| переменных в `.env.example`      | **99** активных ключей                                                                                                                                                                                                                                                                                                                 | 99                                                                                                                    | `git show origin/main:casino-platform/.env.example \| grep -cE '^[A-Z][A-Z0-9_]*='`                                                                     |
| контроллеров API                 | **30**, из них 2 с `@Body` вне Zod (задокументированные HMAC-exempt: `payments-webhook`, `provider-callback`)                                                                                                                                                                                                                          | 30 / 2                                                                                                                | `git grep -l '@Controller' origin/main -- casino-platform/apps/api/src \| wc -l`                                                                        |
| гардов архитектуры / docs-чеков  | **G1…G23** (23), **D1…D10** (10)                                                                                                                                                                                                                                                                                                       | те же                                                                                                                 | `git grep -ohE '\bG[0-9]+\b' origin/main -- .github/workflows/architecture-guards.yml \| sort -u \| wc -l` (аналогично `D` по `docs-guard.yml`)         |
| базлайны техдолга (храповики)    | `use-case-specs` — **0** (был 28 до #134), `eslint-disable` — **0** (был 13 до #136), `raw-error` — **0** (был 1 до #136), `nest-exceptions` — **3 файла** (было 4 до #136), `cross-module-imports` — **7 файлов**, `pnpm-audit` — **3/19/27/3**                                                                                       | #141: `cross-module-imports` **5 файлов** (7→5); #140: `pnpm-audit` **0/0/1/2** (mute-лист 50→25 GHSA, overrides 2→7) | `git show <ref>:casino-platform/tech-debt/<правило>.txt`                                                                                                |
| файлов в модуле `affiliate`      | **45** (44 `*.ts` + `README.md`)                                                                                                                                                                                                                                                                                                       | 45                                                                                                                    | `git ls-tree -r --name-only origin/main -- casino-platform/apps/api/src/modules/affiliate \| wc -l`                                                     |
| страниц `page.tsx` (admin / web) | **20** / **36**                                                                                                                                                                                                                                                                                                                        | 20 / 36                                                                                                               | `git ls-tree -r --name-only origin/main -- casino-platform/apps/admin/src \| grep -c 'page\.tsx$'` (аналогично `apps/web`)                              |
| markdown-файлов документации     | **36** в `docs/` + 4 в `docs/archive/` (плюс `manual-migrations/` c собственным README)                                                                                                                                                                                                                                                | те же                                                                                                                 | `git ls-tree --name-only origin/main:casino-platform/docs \| grep -c '\.md$'`                                                                           |

История противоречий, которые этот раздел закрывает: шапка файла утверждала «api 203 unit/integration + 9 E2E,
web 157, admin 6»; срез GAP-58 — «api 195 passed/21 skipped, web 161, admin 11»; README — «api 472 unit/integration
(410 прогнано локально + 62 в 12 файлах интеграций/E2E)», QA_CHECKLIST — «api 403 + 12 файлов, web 177, admin 11».
Разброс 195…472 объясняется тем, что счётчики обновлялись в разное время и разными PR (#88, #128, `5d2bd67`),
а пересчёт состава файлов не делался ни разу.

## 5. Не является гэпом — не переделывать (проверено 2026-09-02, повторено 2026-10-02)

| Позиция                                                               | ID       | Обоснование                                                                                                                     |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Бонусы, вейджер, промокоды, турниры                                   | NOT_GAP  | ТЗ ч.5 §2.8 («бонусного движка в релизе нет») и ч.1: отсутствие в коде — соответствие; ТЗ прямо запрещает рисовать «Бонус: 0 ₽» |
| Live/настольные/быстрые игры как разделы каталога                     | NOT_GAP  | ТЗ ч.5: «не добавлять заранее»                                                                                                  |
| Ручные выплаты по выводам                                             | NOT_GAP  | так спроектировано в ТЗ ч.3: админ переводит вручную и подтверждает; массовые выплаты через API Rukassa — фаза 2                |
| Prometheus + Grafana                                                  | NOT_GAP  | ТЗ ч.7 §12.1 объявляет их излишними для MVP                                                                                     |
| 2FA для админки                                                       | NOT_GAP  | в ТЗ отсутствует (0 упоминаний); добавлять только по решению владельца                                                          |
| Фиатные депозиты на политических константах курса (`toRubEquivalent`) | ACCEPTED | осознанное решение GAP-34: расчёт `amountRub` для KYC-лимита, а не display-конвертация                                          |
| Redis недоступен → `/health/ready` 200 `degraded`                     | ACCEPTED | осознанное решение GAP-35: деградация очередей ≠ отказ API; БД недоступна → 503 fail-closed                                     |
| `/withdraw` как отдельная страница рядом с листом                     | NOT_GAP  | ТЗ §19 не требует листа для вывода; страница оставлена тонким хостом ради прямых ссылок (GAP-55 п. з)                           |
| `catalog` на CSR вместо ISR                                           | ACCEPTED | отклонение зафиксировано в досье GAP-55 (п. е): ISR по произвольным query дал бы устаревшие выдачи                              |
| Виртуализация сеток библиотекой                                       | ACCEPTED | `content-visibility: auto` вместо windowing — обоснование в досье GAP-55                                                        |
| KYC-загрузчик через dynamic import                                    | NOT_GAP  | тяжёлой библиотеки нет (`FormData` + `fetch`), выгоды нет — отметка снята с обоснованием                                        |

## 6. Досье позиций (обоснования, критерии, история — перенесены из ячеек таблицы без потерь)

### GAP-01. Модуль auth был неполным (P0, 2026-08-23) — ✅ CLOSED

Восстановлены отсутствующие файлы по контрактам уже существующих use-case'ов: `domain/errors.ts`
(AppError-классы INVALID_CREDENTIALS, EMAIL_NOT_VERIFIED, TOKEN\_\_, SESSION\_\_), `domain/entities/user.entity.ts`,
четыре порта репозиториев (+ barrel), `infrastructure/services/password-hasher.service.ts` (argon2id),
`jwt.service.ts` (HS256 на node:crypto — jsonwebtoken был недоступен в оффлайн-store той среды),
`email-queue.service.ts` (dev — лог со ссылкой, prod без SMTP_HOST — fail-closed `EmailNotConfiguredError`),
четыре Prisma-репозитория, `application/use-cases/register.use-case.ts` (уникальность email, реферальный код
8 символов UC-REF-01/02, verification-токен 24 ч). Попутно починены: `admin/infrastructure/admin-jwt.service.ts`
(импортировал отсутствующий jsonwebtoken), битый путь импорта zod-validation.pipe в auth.controller,
`meta` в `ApiSuccessResponse` (+PaginationMeta), ~25 strict-mode ошибок TS7006/7031/6133 в старых модулях.
Проверка тогда: `tsc --noEmit` @casino/api = 0 ошибок; runtime-проверка требовала БД+Redis и не выполнялась.
Сейчас регрессию ловит E2E `apps/api/test/e2e/player-lifecycle.e2e.spec.ts` (регистрация → login → …) и
юнит-спеки `auth-register`, `auth-login`, `auth-refresh`, `auth-logout`, `auth-verify-email`, `auth-forgot-password`,
`auth-reset-password`, `auth-google-oauth`.

### GAP-02. BullMQ-инфраструктура и письма (P1) — ✅ CLOSED

Состав: `apps/api/src/queues/queue.types.ts` (`EMAIL_QUEUE_PORT`, `EmailJobData`,
`EnqueueResult`), `infrastructure/email.queue.ts` (продюсер BullMqEmailQueue: attempts 5, backoff exp 5s,
removeOnComplete/Fail + fallback DevLogEmailQueue), `infrastructure/smtp.mailer.ts` (`MAILER_PORT`: SmtpMailer
через ленивый require nodemailer / DevLogMailer; в production без `SMTP_HOST` приложение не стартует),
`application/email.worker.ts` (консьюмер очереди `email`, проставляет `notifications.sentAt`). Продюсеры:
auth (verify/reset письма с HTML) и notifications (UC-NOTIF-01 с проверкой `user_settings.notificationsEmail`).
Env: добавлены опциональные `SMTP_PORT/SMTP_USER/SMTP_PASS`.

- **Rich HTML-шаблоны — закрыто 2026-09-27** (ветка `feat/email-html-templates`): `apps/api/src/queues/templates/index.ts` —
  брендированный 600px table-layout (inline-стили, без внешних CSS/картинок/шрифтов) + билдеры всех 4 писем
  (email-верификация, сброс пароля, withdrawal-reminder, generic notification) с сохранённым дословно plain-text
  fallback; продюсеры (auth/notifications/maintenance) передают `html` в очередь, SmtpMailer отдаёт его в nodemailer
  (`smtp.mailer.ts:94`). Спек: `apps/api/test/email-html-templates.spec.ts`. Старый стаб
  `modules/notifications/templates/index.ts` (plain text, нигде не импортируется) не тронут.
- **Воркер в отдельном процессе — закрыто 2026-09-27** (ветка `feat/email-worker-process`): консьюмер управляется
  env-флагом `EMAIL_WORKER_IN_PROCESS` (дефолт `true` — в процессе API для dev; `false` — API только кладёт в очередь);
  entrypoint `apps/api/src/worker.ts` — Nest ApplicationContext без HTTP (ConfigModule + pino + QueuesModule,
  Prisma через `@casino/database`), SIGTERM → `worker.close()` (grace 45s); сервис `worker` в
  `docker-compose.prod.yml:60-69` — тот же образ, что api (`node apps/api/dist/worker.js`, флаг `true`, без healthcheck),
  у api флаг `false`. Maintenance-воркер (GAP-33) сознательно остался в процессе API — вне скоупа.

### GAP-03 / GAP-04. Google OAuth и Telegram Login (P1) — 🟦 CODE_DONE

- Google: authorization-code flow — `GET /auth/google/url` (state = HMAC, 10 мин), `POST /auth/google` (обмен кода,
  userinfo, провижининг через `OAuthUserProvisioningService`, сессия + refresh-cookie). Требует
  `GOOGLE_CLIENT_ID/SECRET`.
- Telegram: `POST /auth/telegram` — верификация виджета (secret = SHA256(bot_token), HMAC по data-check-string,
  `timingSafeEqual`, `auth_date` ≤ 24 ч), пользователь без email (schema nullable), сессия. Требует `TELEGRAM_BOT_TOKEN`.
  `POST /auth/telegram/preview` — та же верификация, но БЕЗ сессии и без cookies: возвращает проверенный профиль и
  `accountExists`, чтобы колбэк-страница спросила игрока («Вход» / «Регистрация») до того, как вход совершён.
- Контракт подписей закрыт спеком `oauth-verify.spec.ts` (17 кейсов: GAP-42 + preview); Telegram-хэш дополнительно проверен
  2026-09-09 на payload, подписанном РЕАЛЬНЫМ токеном (наш `verify` принимает, подделка отбивается).
- **Не сделано:** `GET /auth/google` против настоящего `redirect_uri` и живой логин виджетом на публичном домене
  (нужен BotFather `/setdomain`) → пункт 5 критерия GAP-46.

### GAP-05. Email-отправка (P1) — ✅ CLOSED (вместе с GAP-02)

Очередь + воркер + SmtpMailer; fail-closed: prod без `SMTP_HOST` не стартует, а не «тихо теряет письма».
Регресс имени переменной закрыт GAP-40 + спеком `smtp-mailer.spec.ts` (6 кейсов, включая «НЕ читает устаревшее
`SMTP_PASS`»). Живая доставка по реальному SMTP — пункт 1 критерия GAP-46.

### GAP-06 / GAP-07. Rukassa и NOWPayments (P1) — 🟦 CODE_DONE

- Rukassa: реальный HTTP `POST {RUKASSA_API_BASE}/api/v1/order/create` (заголовки `shop_id`/`api_key`, timeout 30 с),
  `getPaymentStatus`; dev без ключей — лог-стаб; верификация вебхука HMAC-SHA256 активна в prod (раньше кидала
  NOT_IMPLEMENTED).
- NOWPayments: `POST /v1/payment` (x-api-key), `/estimate`, `/payment/{id}`; курсы не хардкод при наличии ключа;
  IPN HMAC-SHA512 активен в prod; env `NOWPAYMENTS_API_BASE`.
- **Проверено живым контуром 2026-09-09** (первый внешний ключ, ключ предоставлен владельцем): `GET /v1/currencies` →
  236 валют; `/v1/estimate` в обе стороны для usdttrc20/btc/ton/trx/ltc; `/v1/min-amount` (usd→usdttrc20 = 19.2);
  создан тестовый payment_id 5120213360 (12 USD → USDTTRC20, адрес TMr2…CH3, статус `waiting`, оплата не производилась);
  `/v1/payout` доступен (список пуст); IPN-секрет получен, эталонная канонизация (sorted keys → compact JSON →
  HMAC-SHA512) проходит нашим `verifyIPN`, подделанная отбивается; секрет только в env стенда, в репо не попадал.
- **Не сделано:** реальная оплата + живой IPN на наш вебхук (нужен публичный URL вместо example.com), боевые ключи
  Rukassa → GAP-46 п.1–2. Отдельный unresolved — TZ-02 (маппинг TON/TRX/LTC).

### GAP-08. GitSlotPark вместо «только DemoProvider» (P1) — 🟦 CODE_DONE

Адаптер `gitslotpark.adapter.ts` — агрегатор Pragmatic Play / PG Soft / Amatic / Amusnet (один seamless-протокол
на 4 бренда): `userAuth`/`gamelist` + callback-операции GetBalance/Withdraw/Deposit/BetWin/Rollback с
HMAC-SHA256-sign, маршруты `/provider-callback/gitslotpark/{Op}`. До продакшена: (1) сверить порядки конкатенации
sign по каждой операции с менеджером GSP (GAP-43, §3.2), (2) связка `userID → сессия` в GameCallbackService и
атомарность BetWin — проверить runtime с тестовыми ключами (GAP-46 п.3).

### GAP-09. Admin syncGames (P2) — 🟦 CODE_DONE

`syncGames` вызывает `adapter.fetchGameList()`, upsert по `[providerId, externalGameId]`, slug = name + md5-суффикс,
обновляет rtp/thumbnail/hasDemo/metadata, пересчитывает gameCount; новые игры создаются выключенными (UC-GAME-19).
Кнопка «Синхронизировать» в админке показывает результат. **Замечание ревизии 2026-10-02 и его статус:** логика
синхронизации жила в `apps/api/src/modules/casino/presentation/controllers/casino-admin.controller.ts` и писала в БД
из presentation — архитектурный долг В3 в [TECH_DEBT.md](TECH_DEBT.md) (10 записей в этом контроллере). **Снято #138**
(`1abe706`, в `main`): 10 записей → 4 use-case (`admin-sync-provider-games`, `admin-update-game`, `admin-set-game-flags`,
`admin-set-provider-enabled`) + порты `IGameCatalogRepository`/`IGameProviderRepository`, под каждым — спек
(5 файлов-спека по `git diff --name-status`; «23 теста» — цифра из текста PR, в этом дереве не перепроверялась);
по модулям users+casino записей `prisma.*` в presentation осталось 0 из 11. Статус GAP-09 при
этом не меняется: `CODE_DONE`, потому что не хватает не слоя, а живого провайдера (каталог ни с одним боевым GSP
не синхронизировался).

### GAP-10 / GAP-11 / GAP-12. Админка: фронт, метрики, batch-операции — ⚠️ частично без машины

- GAP-10 ✅ CLOSED: реальный UI (13+ страниц в `apps/admin/src`, с 2026-09-29 — плюс 6 страниц партнёрской программы):
  логин c JWT (zustand persist), guard-layout, дашборд на живых metrics/charts/events + Recharts, users (block/unblock),
  transactions, payments, withdrawals (single + batch approve/reject), KYC (approve/reject/resubmit), games/providers
  (toggle/sync), support (диалог + внутр. заметки + приоритет + close), referrals (stats), audit, admins
  (superadmin CRUD), settings. Листинги были сломаны по форме конверта — починено аудитом GAP-58 и закрыто тестом
  `apps/admin/test/api-get-full.spec.ts`.
- GAP-11 ⚠️ CLOSED_WORD: `admin/application/dashboard.service.ts` + `AdminDashboardController`
  (`/admin/dashboard/metrics|charts|events`), raw SQL по `date_trunc`, деньги string. Тестов нет; runtime проверялся
  только чтением при аудите контрактов 2026-09-27 («контракты сходятся»).
- GAP-12 ⚠️ CLOSED_WORD: `POST /admin/withdrawals/batch-approve|batch-reject`
  (`apps/api/src/modules/admin/presentation/controllers/admin-finance.controller.ts:333,365`) — независимая обработка
  каждой заявки + audit-log сводки; single-эндпоинты рефакторнуты на общие helpers +
  `WithdrawalInvalidStatusError`(AppError). Тестов на batch-путь нет.

### GAP-13. Реферальные награды: `runDaily` не вызывался (P1) — ✅ CLOSED (был ⚠️ «частично»)

История: `referrals/application/referral-calc.service.ts:56-60` помечал награды `credited` без реального зачисления —
это было верно исправлено (зачисление идёт через `walletFacade.credit`, тип `REFERRAL_REWARD`, ключ
`ref_reward_<id>`), но начисления не происходили, потому что `runDaily` не вызывался никем: «Полгода числился
закрытым при неработающем начислении» — причина, по которой в аудит 2026-09-01 введён обязательный формат
«Критерий приёмки». С 2026-09-02 (GAP-32) вызов есть: cron-задача
`apps/api/src/modules/maintenance/application/referral-daily.job.ts:21` (`referralCalc.runDaily`) и ручной
`POST /admin/referrals/run-daily` (`apps/api/src/modules/maintenance/presentation/maintenance-admin.controller.ts:53`,
user-JWT `@Roles('superadmin')`, Zod-схема, audit-log `referrals.run_daily`). Дедуп внутри `runDaily`
(findReward по дню+валюте + idempotencyKey проводки). Регрессия: `referral-payout.integration.spec.ts` на реальном
Postgres (GGR 80 → проводка REFERRAL_REWARD 4.00 (5%), `idempotencyKey=ref_reward_<id>`, статус `credited`;
повтор за тот же день — credited 0; win > bet → `zero`, проводок нет).

### GAP-14 / GAP-15. KYC-админ и канал уведомлений

- GAP-14 ✅ CLOSED: `GET /admin/kyc/:id` вместо `{todo:true}` возвращает профиль + документы + `totalDepositedRub`
  (`apps/api/src/modules/kyc/presentation/controllers/kyc-admin.controller.ts:60`).
- GAP-15 ⚠️ CLOSED_WORD: `NotificationService` учитывает настройки и канал email —
  `apps/api/src/modules/notifications/application/notification.service.ts:41`
  (`settings?.notificationsEmail ?? true`); enqueue в очередь `email`, `sentAt` проставляет воркер (GAP-02).
  Теста на ветку «пользователь отписался → письмо не ушло» нет.

### GAP-16. README честен про прогресс ТЗ (P3) — ✅ CLOSED (переоткрыт 2026-10-02, закрыт 2026-10-03 в этой ветке)

Гэп 2026-08-23: README отмечал `[x]` все семь частей ТЗ при неработающих OAuth/PSP/jobs. Исправление тогда:
раздел «TZ Progress» с процентами и ссылкой на этот файл. **Что было не так на `89881eb`:** README:49 —
«Prisma schema (19 таблиц)» при 31 модели; README:70 — «Optimistic locking `wallet_accounts.version`, retry ×3»,
хотя GAP-57 (закрыт 2026-09-30) заменил Serializable+retry×3 на advisory-лок + ReadCommitted + повтор ×5, и сам
README строкой ниже это же и описывал (файл противоречил сам себе); GAP-46 в блокерах не отражён корректно.

**Сверка 2026-10-03 (что сделано в этой ветке):** все четыре пункта устранены в `README.md` — модели/enum
(31/31 по команде), модули (14), ключи env (104 в `env.validation.ts`, 99 в `.env.example`), формулировка
про лок приведена к ADR GAP-57 («advisory-лок + ReadCommitted, повтор ×5»), в блокерах остались **только
GAP-46 и GAP-49**, добавлена строка «Часть 8 Affiliate», счётчики тестов переписаны в spec-файлы с командами
замера и датой. **Оговорка статуса:** на `main` README расходится до мержа этой ветки; закрытие подтверждено
чтением файла, а не гардом — `docs-guard` проверяет ссылки (D1) и существование путей из бэктиков (D2), но не
актуальность чисел в README (см. §3.3, строка «словом»). Класс регрессии тот же, что у GAP-37 и GAP-56.

### GAP-17. KYC-лимит во фронте (P2) — ✅ CLOSED (был ⚠️ «не используется»)

`apps/web/src/lib/api/kyc.api.ts:16` (тип `KycStatus` с `limit_remaining`/`limit_currency`/`deposit_limit_rub`),
`apps/web/src/app/kyc/page.tsx:155,170` (остаток из API, без клиентского пересчёта),
`apps/web/src/components/wallet/DepositSheet.tsx:282-284,398-401` (остаток в валюте шита; при исчерпании CTA
«Лимит исчерпан — пройти верификацию» → `/kyc` ДО отправки формы, а не 422 после). Регрессия: `kyc-page.spec.tsx`,
`deposit-sheet.spec.tsx` (GAP-36/GAP-44). Историческая путаница: гэп описывался как «лимит проверяется только на бэке»
и был выделен в GAP-36; обе позиции теперь закрыты и связаны.

### GAP-18…GAP-29 (аудит 2026-08-25) — сводка закрытий

| ID     | Дата/PR закрытия                      | Машинное подтверждение                                                                                                                                                                                                                                                                                       | Что зафиксировано в обоснование                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-18 | 2026-08-30                            | `apps/api/test/account-lockout.spec.ts` (5)                                                                                                                                                                                                                                                                  | поля `failed_login_attempts/last_failed_at/locked_until` (миграция `20260830_account_lockout.sql` — применить при деплое); 10 неудач/15 мин → блок 30 мин; enumeration-safe (неверный пароль → всегда INVALID_CREDENTIALS, лок виден только при верном); уже заблокированный аккаунт не продлевается (DoS-защита); env `LOCKOUT_MAX_ATTEMPTS/WINDOW_MS/DURATION_MS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| GAP-19 | 2026-08-30                            | `apps/api/src/app.module.ts:39`, guard в auth-контроллерах                                                                                                                                                                                                                                                   | `@nestjs/throttler` v6, глобальный ThrottlerGuard 120 req/мин на IP; `/auth/*` — 10/мин; вебхуки провайдеров и game-callback — `@SkipThrottle()` (у них HMAC). Исключение 2026-09-29: `/auth/refresh` — свой лимит 30/мин (`THROTTLE_REFRESH_LIMIT`), т.к. это зонд сессии при каждой загрузке страницы, а классовый AUTH-лимит давил легитимные сессии (NAT/офис; в проде внешним ограничителем остаётся nginx `api_auth 10r/m`). Env `THROTTLE_TTL_MS/GLOBAL_LIMIT/AUTH_LIMIT/REFRESH_LIMIT`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GAP-20 | 2026-08-30                            | `apps/api/src/main.ts`                                                                                                                                                                                                                                                                                       | `app.use(helmet())` в bootstrap до парсеров; API отдаёт только JSON → дефолтный CSP безопасен, `frame-ancestors 'none'` против clickjacking                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GAP-21 | 2026-08-30                            | use-case-спеки модулей                                                                                                                                                                                                                                                                                       | `@UsePipes(new ZodValidationPipe(Schema))` на всех клиентских `@Body` (auth incl. google/telegram, users profile/settings/self-exclude, casino launch/demo, kyc submit/documents, support + support-admin, все admin-контроллеры incl. finance credit/debit/batch); неизвестные ключи вырезаются (anti mass-assignment). **Exempt (задокументировано в коде):** `payments-webhook` и `provider-callback` — payload'ы провайдеров под HMAC, жёсткая схема отбила бы валидные коллбэки. Пересчёт 2026-10-02: из 30 контроллеров `@Body` без pipe только эти два                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GAP-22 | 2026-08-31                            | `apps/api/test/wallet-withdrawal-ops.spec.ts`                                                                                                                                                                                                                                                                | 4-слойка: `LockFundsUseCase`/`UnlockFundsUseCase`/`ConfirmWithdrawalUseCase` в `application/use-cases/` (WalletFacade делегирует, внешний API прежний); `runCreditDebit` разбит (`getOrCreateWallet` + `applyCreditDebit`); `toMoney` без any, tx-клиенты `Prisma.TransactionClient`, `CreditInput.type: LedgerEntryType` (поймал реальный баг lowercase-типа); 0 `as any`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GAP-23 | 2026-08-30                            | `apps/api/test/logger-redact.spec.ts` (3)                                                                                                                                                                                                                                                                    | `nestjs-pino` + pino-http (`useLogger`); redact-пути `password/token/authorization/cookie/set-cookie` на 3 уровнях вложенности + `req.body.*`; кастомный req-сериализатор; `GlobalExceptionFilter` логирует только type/message/stack; корреляция request-id между pino и RequestIdMiddleware через общий `resolveRequestId`; env `LOG_LEVEL/LOG_FORMAT`; секреты физически отсутствуют в выводе лога                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| GAP-24 | 2026-08-31                            | `money-flow.spec.ts` (11), `ledger.integration.spec.ts` (6 на реальном Postgres: откат tx при сбое и идемпотентность на Serializable-БД), `nowpayments-ipn.spec.ts` (13), `kyc-file-sniffer.spec.ts` (8), `account-lockout.spec.ts` (5), `logger-redact.spec.ts` (3), E2E `player-lifecycle.e2e.spec.ts` (9) | интеграции помечены `LEDGER_INTEGRATION=1` и идут в CI после `prisma db push`/`migrate deploy`; в локальной среде без БД не запускаются — поэтому «21 skipped» в прежних счётчиках                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GAP-25 | 2026-09-01                            | гард G13 + `QUALITY_GATES.md` §2.1.1                                                                                                                                                                                                                                                                         | пороги `max-params` warn(4)→error(3), `complexity` warn(10)→error(10); разобраны 45 `max-params` + 13 `complexity` в `apps/api/src`; бизнес-методы переведены на input-объекты (wallet lock/unlock/confirm → `WithdrawalOpArgs`, `kyc.setStatus`, support createTicket/listUserTickets/addMessage, referrals sumTransactions/findReward/processUserRewards, casino findRoundsWithGame/findOrCreateRound/creditWin, notifications.list, payment-request.listUser, favorites.history, webhook execute → `Process*WebhookInput`); complexity — на приватные методы/таблицы (`sniffDocumentMime`, GlobalExceptionFilter, syncGames, provider-callback.handle, GitSlotPark verify/parse, Rukassa/NOWPayments webhook). Исключения только framework-imposed и описаны: overrides `max-params: off` для `**/*.controller.ts` + `src/main.ts`, inline-disable для 10 DI-конструкторов. **Пересчёт 2026-10-03:** inline-подавлений не осталось — #136 обнулил базлайн `eslint-disable` (13 записей → 0, `git show origin/main:casino-platform/tech-debt/eslint-disable.txt` пуст; `git grep -n eslint-disable` по `apps/*/src` + `packages` без спеков = 0) |
| GAP-26 | 2026-09-01                            | E2E на собранном dist (`pnpm build` → `node apps/api/dist/main.js`)                                                                                                                                                                                                                                          | 72 импорта (все с ≥3 `../`) переведены на `@modules/<mod>/…` и `@/<seg>/…`; внутримодульные `../` оставлены; рантайм-резолвер не нужен: `nest build && tsc-alias -p tsconfig.build.json` переписывает алиасы в относительные пути в `dist`; `baseUrl`+`paths` в `apps/api/tsconfig.json`, алиасы продублированы в `vitest.config.ts`; правила — CONVENTIONS §3.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GAP-27 | 2026-08-30                            | чтение `password-hasher.service.ts`                                                                                                                                                                                                                                                                          | `argon2.hash(plain, {type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4})` — совпадает с SECURITY_BASELINE §2.1 и admin-хэшером `admin-users.service.ts:28`; прямого теста параметров нет (покрытие косвенное через E2E)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GAP-28 | 2026-09-01                            | `apps/api/test/deposit-idempotency.spec.ts` (4)                                                                                                                                                                                                                                                              | ключ проводки депозита — `deposit_<provider>_<externalId>` (был `deposit_<pr.id>`, защищал только уникальность нашей платёжки); повторный коллбэк по тому же внешнему платежу, смэпившийся на другую платёжку, больше не зачислит дважды — уникальный индекс `ledger.idempotencyKey` отсекает на уровне БД; первый уровень (`pr.status === 'completed'` → duplicate до wallet.credit) сохранён; отсутствие external_id — без зачисления. На `89881eb`: `process-nowpayments-webhook.use-case.ts:109`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GAP-29 | 2026-08-30, **перезакрыт 2026-10-01** | гард D3 + `apps/api/test/env-validation.spec.ts` (3)                                                                                                                                                                                                                                                         | исходное закрытие («все 39 ключей §22 в схеме, D3 молчит») опиралось на **лживый детектор**: D3 искал ключи регуляркой `^  [A-Z]` (ровно два пробела), а ключи `envSchema` лежат на четырёх — не находил ни одного и объявлял невалидированными все 99 переменных при 98 покрытых. Детектор исправлен (`^ +`), настоящий остаток — 6 переменных (`ADMIN_DOMAIN`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `THROTTLE_REFRESH_LIMIT`, `WALLET_LOCK_TIMEOUT_MS`) — добавлен в схему как optional, регрессия закрыта спексом паритета с негативом на сам парсинг                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### GAP-30. Длинные методы (P3, PR-0) — ✅ CLOSED

14 методов 61–88 строк (prettier-инфляция после `--fix`): `game-callback.service` bet/win/rollback,
`dashboard.service` metrics/events, `wallet.ledger.prisma` runCreditDebit/lock/unlock/confirmWithdrawal,
`list-games.use-case` execute, webhook execute ×2, `provider-callback.controller` handle. Закрыто 2026-09-02:
`max-lines-per-function` 90→60 (попутно max-params-фикс в applyRollback — entry-объект вместо 7 параметров);
рефакторинг `wallet.ledger.prisma.ts` (общие existingDuplicate/withRetry/findWalletOrThrow/ledgerEntry) и
`game-callback.service.ts` (applyRollback вынесен из rollback). **Дефект разметки, исправленный этой ревизией:**
в прежнем файле статус этой позиции лежал в 6-й ячейке при 5-колоночном заголовке, то есть формально строка была
«без статуса». Сейчас: `корневой .eslintrc.js`:86 (max 60, skipBlankLines+skipComments), override `:152` —
off только Next.js pages с обоснованием (GAP-39 stage 9b).

### GAP-31…GAP-38 (аудит готовности 2026-09-01) — досье

> Формат, введённый этим аудитом и сохранённый здесь: пункт закрывается **только при выполнении критерия
> приёмки целиком**; отметка «готово» без критерия — причина, по которой GAP-13 полгода числился закрытым при
> неработающем начислении (см. досье GAP-13).

- **GAP-31. Нет Prisma-миграций. ✅ P0, закрыт 2026-09-02 (PR #26).** Baseline `migrations/0_init/migration.sql`
  (774 строки, 27 CREATE TABLE, все enum/индексы/FK) сгенерирована `prisma migrate diff --from-empty` из
  `schema.prisma` — покрывает и три historical `manual/*.sql` (поля `last_payment_method`, `self_excluded_until`,
  account lockout включены); manual-скрипты перенесены в `docs/archive/manual-migrations/` (Prisma считает каждый
  подкаталог `migrations/` миграцией и без `migration.sql` падает P3015 — ходовой кейс пойман CI);
  `migration_lock.toml`: postgresql. В CI `db push` заменён на `migrate deploy` + дрейф-детектор
  (`migrate diff --from-schema-datasource --to-schema-datamodel`, непустой вывод = падение джобы; шаг
  `Verify no schema drift`, ci.yml:161). Примечание: на БД, созданных ДО введения миграций, один раз выполнить
  `migrate resolve --applied 0_init` (см. README в архиве manual). Для применимости в проде: schema-engine не
  запускается на Android/Termux — генерация выполнена одноразовым workflow на ubuntu-раннере (артефакт), workflow
  удалён из ветки до мержа. Критерии: 1) baseline покрывает 27 моделей + 3 manual — далее их стало 31 (2 миграции
  affiliate + индексы), проверка дрейфа в CI это покрывает; 2) пустой Postgres → `migrate deploy` создаёт схему —
  проверяется в CI; 3) дрейф-детектор встроен; 4) manual перенесён; 5) `migrate deploy` вместо `db push`.
- **GAP-32. Реферальные начисления не происходят никогда. ✅ P0, закрыт 2026-09-02.** См. досье GAP-13: cron
  `referral-daily` (`JOB_REFERRAL_DAILY_EVERY_MS`, дедуп внутри `runDaily`) + ручной `POST /admin/referrals/run-daily`
  (user-JWT `@Roles('superadmin')`, Zod-схема, audit-log `referrals.run_daily`); интеграционный тест на реальной БД;
  повторный запуск за тот же день — credited 0; win > bet → zero. **Попутный фикс:** RolesGuard читал метаданные
  только с хендлера — class-level `@Roles` на admin-контроллерах игнорировался (любой user проходил); теперь
  `getAllAndOverride([handler, class])` + `apps/api/test/roles-guard.spec.ts`.
- **GAP-33. Ни одного scheduled job. ✅ P1, закрыт 2026-09-02.** BullMQ Job Schedulers (`upsertJobScheduler`,
  очередь `maintenance`, `apps/api/src/queues/infrastructure/maintenance.scheduler.ts` + воркер
  `modules/maintenance/infrastructure/maintenance.worker.ts`): `expire-deposits` (5 мин; крипто по `expires_at`,
  фиат по 2 ч; условный updateMany — гонка с вебхуком не затирает `completed`), `update-rates` (5 мин;
  NOWPayments `/estimate` → `exchange_rates` + Redis TTL 5 мин; фиат — константы `source='static'`),
  `withdrawal-reminder` (1 ч; email активным admin_users + audit_log, дедуп 24 ч), `referral-daily` (24 ч).
  Юнит-тесты — `apps/api/test/maintenance-jobs.spec.ts`; документировано в `.env.example` + ENVIRONMENT_VARIABLES
  §2/§22 (D3). **Отклонение критерия 3 (задокументировано):** `notifications` имеет FK на `users` (админы — в
  `admin_users`) → уведомление админам = email через `EMAIL_QUEUE_PORT` + запись в `audit_logs`, дедуп по
  audit-записи. Без Redis / `NODE_ENV=test` — no-op (как EmailWorker). В 2026-09-29 тот же планировщик принял
  три задачи партнёрской программы (GAP-61).
- **GAP-34. Курсы валют захардкожены. ✅ P1, закрыт 2026-09-02.** `ExchangeRatesService`
  (`apps/api/src/modules/geo/application/exchange-rates.service.ts`): приоритет Redis-кеш `exchange_rates:rub` →
  последняя запись `exchange_rates` (по `currencyFrom/currencyTo='RUB'`, `fetchedAt desc`) → fallback
  `DISPLAY_RUB_RATES`; курс старше 1 ч (`RATE_STALE_AFTER_MS`) — warn, запрос не роняем; сбой источника —
  fallback static, не 500. `PrismaExchangeRatesReader` — Redis lazy + БД. `GeoFacade.convertRubToDisplay` стал
  async (единственный потребитель — KYC get-status, обновлён); `convertRubToDisplayAmount` принял `rateOverride`.
  Тесты: `apps/api/test/exchange-rates.spec.ts` (приоритет кеш/БД/fallback, stale, RUB-шорткат, форматирование с
  override). **Остаток:** админ-отчётность GGR в валютах читает те же политические константы (вне изначального
  критерия, P3) — см. §5 «не является гэпом» про `toRubEquivalent`.
- **GAP-35. Health-эндпоинты фиктивные. ✅ P1, закрыт 2026-09-02.** `/health/ready` — `SELECT 1` к БД
  (недоступна → 503 fail-closed) + `PING` Redis (недоступен → 200 `degraded:true` — деградация очередей, не отказ
  API); healthcheck в `docker-compose.prod.yml` переведён на `/health/ready` (строка 50); liveness не тронут.
  `/health/details` сознательно не заводился (сервисы и счётчики видны в логах/метриках). Тесты:
  `apps/api/test/health-ready.spec.ts` (db fail → 503, redis fail → degraded, без `REDIS_URL` → degraded без
  коннекта, liveness статический). E2E `wait-on` теперь честный — упадёт при мёртвой БД.
- **GAP-36. KYC-лимит не виден игроку. ✅ P2, закрыт 2026-09-02.** См. досье GAP-17: страница KYC показывает
  остаток лимита из API (`getKycStatus` из нового `apps/web/src/lib/api/kyc.api.ts`, поля `limit_remaining` /
  `limit_currency` / `deposit_limit_rub`; типизированный `KycStatus` вместо `any`) + при исчерпании красный блок с
  CTA «Пройти верификацию» (анкор на форму, без ошибки 422 после отправки); DepositSheet показывает остаток в
  валюте шита и меняет CTA → роут на `/kyc` (критерий 2: до отправки формы); пересчёта на клиенте нет
  (критерий 3); статус approved — лимит снят.
- **GAP-37. Дрейф деплой-документации. ⚠️ P3, закрыт 2026-09-02 — словом.** DEPLOY.md переписан под фактический
  пайплайн (единый ci.yml, deploy-job после 4 чеков, deploy-skip без VPS-секретов, `migrate deploy` на деплое);
  `infra/scripts/resource-check.sh` добавлен по образцу ТЗ ч.7 §12.3 (CPU 85% / RAM 90% / disk 85% + проба
  `/health/ready`, cron `*/5`); в ТЗ-эскизе deploy.yml — пометка «в репо не существует, фактический пайплайн —
  DEPLOY.md»; заодно в Monitoring — честный readiness (GAP-35) и ресурс-скрипт. **Почему `CLOSED_WORD`:** машина
  не проверяет, что DEPLOY.md описывает текущий пайплайн; docs-guard D2/D5 проверяют существование путей и
  несъезд производных файлов, но не актуальность текста. Класс регрессии: GAP-56 (2026-09-27) снова нашёл расхождение
  доков с compose, а GAP-16 — расхождение README с кодом.
- **GAP-38. На чистом проде некому войти в админку. ✅ P2, закрыт 2026-09-02.** Seed fail-closed при
  `NODE_ENV=production` — отказ без `SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD` и при дефолтном dev-пароле (exit 1 до
  обращения к БД); DEPLOY.md — раздел «Первичная инициализация админа»; повторный запуск идемпотентен (upsert по
  email). Guard вынесен в `packages/database/src/seed-guard.ts` (без argon2/prisma-зависимостей — тестируется без
  native-модулей); тест `apps/api/test/seed-guard.spec.ts` (5 кейсов: prod без `SEED_*` → отказ, дефолтный пароль →
  отказ, валидные → ok, dev/test → ok). `SEED_ADMIN_*` уже были в `.env.example` (§ Bootstrap) +
  ENVIRONMENT_VARIABLES §15/§22 — D3-парити.

### GAP-39…GAP-51 (аудит готовности #2, 2026-09-02) — досье

> Повод аудита: после закрытия P0/P1/P2-трекера и зелёного CI задан вопрос «проект готов к запуску?».
> Ответ: **код MVP готов (~85%), приёмка — 0%**. Проверялось машинно: `grep` кода против `.env.example`,
> покрытие тестами по файлам, ТЗ ч.3 §13 / ч.5 §2.8 / ч.7 §12, `docs/QA_CHECKLIST.md`, состав `apps/web`/`apps/admin`.
> Что можно делать без боевых ключей: GAP-39, 40, 41, 42, 43, 44, 45, 48, 51. Требует ключей/стенда: GAP-46
> (runtime-приёмка), GAP-47 (нагрузка). Требует решения владельца: GAP-49 (юридика); GAP-50 (Sentry) — согласовано
> 2026-09-04 и реализовано. GAP-51 — не выход этого аудита, а находка 2026-09-04 при закрытии GAP-48: в коде висел
> `TODO` со ссылкой на GAP-22 на работу, которой в критериях GAP-22 никогда не было, а сам гэп закрыт — из-за чего
> долг выглядел исполненным.

- **GAP-39. Техдолг ESLint: 1171 warning (0 errors) при зелёном CI. ✅ P3, закрыт 2026-09-03 (PR #36–55, stages 1–10).**
  Исходная формулировка (в файле она осталась в статусе «🟡 P3 открыт» — дефект разметки): GAP-25 заявлен закрытым по
  `max-params: error(3)` и `complexity: error(10)`, но не закрыт по `no-explicit-any` — в CI job `Lint` последнего
  коммита `a8c86fe` (run 33632859122) видно `✖ 1171 problems (0 errors, 1171 warnings)`; правило в `.eslintrc.js:32`
  стоит `error`, но через `next lint` для `apps/admin` и `apps/web` понижается до warning (конфликт с
  `eslint-config-next`). Среди 1171: `no-explicit-any` (≈117 в `apps/api` + множество в `apps/admin` pages),
  `no-unsafe-assignment/member-access/call` (каскад от any), `explicit-function-return-type` (Next.js pages),
  `max-lines-per-function >140` (отдельные pages 149–194 строк), `prefer-nullish-coalescing`. Запуску не мешал —
  CI зелёный, typecheck/тесты/билд/E2E проходят; фиксировалось по правилу INDEX.md §6.3.
  **Критерий приёмки:** 1) `pnpm lint` = 0 warnings без понижения уровня для фронта; 2) `no-explicit-any: error`
  работает во всех трёх apps; 3) длинные Next.js pages разбиты или `max-lines-per-function` поднят до 200 с
  обоснованием (QUALITY_GATES §2.3). Допускалось частичное закрытие: api → admin → web.
  **Прогресс по этапам (данные сохранены):** PR #36 — 10 disable для PSP payload parsing (легитимный any);
  PR #37 — типизация сигнатур контроллеров 48 any → 0 (`UserActor`/`AdminActor` из `common/types/req-user.ts`,
  `Prisma.*WhereInput`); PR #38 — 16 `catch (e: any)` → `catch (e)` + `errorMessage()`
  (`common/utils/error-message.ts`); PR #39 — `no-explicit-any: warn → error` в `apps/api/.eslintrc.js`, разобрано
  ~95 any (репозитории на Prisma-типах, доменные интерфейсы ISupportRepository/IKycRepository, module augmentation
  express `Request.user`, структурный тип `SmtpTransport` вместо недоступных типов nodemailer) — api 1171 → 439;
  PR #42 — stage 6: `prefer-nullish-coalescing` (72) с `ignorePrimitives: true`, `no-unnecessary-condition` (18)
  вручную, guard-типизация (admin-auth/roles/roles.guard, admin-jwt.verify → `Record<string, unknown>`) — api → 313;
  PR #43 — stage 6b: return-типы не-контроллеров (261 из 313) — api → 263; PR #46 — stage 7 (apps/web):
  `no-explicit-any: error`, 55 any разобраны, `lib/api.ts` на `ApiResponse<T>`, новые DTO в `src/types/*`
  (casino.ts: GameDto/GamesListDto/GameLaunchDto/HistoryDto; wallet-tx.ts; user.ts: MeDto; referral.ts; support.ts),
  попутно исправлены реальные баги чтения полей (profile/referral/support читали snake_case, API отдаёт camelCase) —
  web ~680 → 123; PR #47 — stage 8 (apps/admin): 13 any, `apiGetFull` на `ApiResponse<T> + ApiMeta`,
  `AdminLoginResponse`, role-union касты, audit payload, withdrawals destination, support/referral типы —
  admin ~530 → 112; PR #49 — stage 9: аннотированы все export-функции/хендлеры, `errText()`/`errCode()`,
  `trySilentRefresh` типизирован, admin SyncResult сверен с API — web 19, admin 16; PR #50 — stage 9b: web и admin
  «✔ No ESLint warnings or errors», `import/no-cycle` разорван выносом axios-interceptors в
  `lib/api-interceptors.ts`, `axios.get<T>` в verify-email, `import { Decimal } from 'decimal.js'`,
  страницы-переращеры разложены (`WithdrawalRow` 216→166, `KycForm` 205→159), `max-lines-per-function: 140→200`
  для Next.js pages с обоснованием в `.eslintrc.js`; PR #51 — поправка трекера (фраза про освобождение
  `explicit-function-return-type` override'ом по §2.1.1 была неточной — §2.1.1 освобождает только `max-params`);
  PR #55 — stage 10 (apps/api → 0): `common/types/express-context.ts` с `getHttpRequest<T>()` (изолирует any от
  `switchToHttp().getRequest()`), `config.get<string>('X')` в 12 местах, `Record<string, unknown>` в
  nowpayments-webhook без disable, `ZodType` в pipe, 206 return-аннотаций, Prisma-namespace с префиксом,
  import-гигиена по main-паттерну; **E2E поймал DI-регрессию:** type-only импорт класса в constructor-параметре
  ломает `design:paramtypes` (Nest can't resolve) — value-импорты DI восстановлены (38 файлов), `ZodValidationPipe`
  оставлен type-only; точечные fixes (`Request.id?`, `cookies`, `candidate as unknown[]`, `RequestWithCookies` +
  `token ?? ''`, `Roles(): MethodDecorator & ClassDecorator`, decimal.js named-import).
  Итог: **0/0/0 warning** (api 1171→0, web ~680→0, admin ~530→0), CI main после squash `6fd0bc5`: lint ✔,
  typecheck ✔, 117 unit + 9 E2E ✔, docker-build ✔, deploy ✔.
  **2026-09-03 — критерий 1 закреплён машиной:** до этого «0 warnings» было свойством _вывода_, а не _exit-кода_ —
  `eslint src --ext .ts` без `--max-warnings` возвращает 0 и при тысячах warnings; именно эта конфигурация позволяла
  GAP-39 числиться зелёным с `✖ 1171 problems`. Теперь `--max-warnings=0` во всех трёх lint-скриптах
  (`apps/api/package.json:10`, `apps/web/package.json:9`, `apps/admin/package.json:9` — проверено 2026-10-02),
  а сам флаг сторожит guard **G13** в `architecture-guards.yml` (удаление — падение Tier 2); обоснование —
  QUALITY_GATES §2.4.
- **GAP-40. SMTP-пароль не доезжает до nodemailer — письма не уходят в проде. ✅ P1, закрыт 2026-09-03 (PR #53).**
  Мейлер читал `SMTP_PASS`, а `.env.example` и `ENVIRONMENT_VARIABLES.md` предписывали оператору `SMTP_PASSWORD`;
  в `env.validation.ts` обе формы `optional()` — валидация расхождение не ловила. Итог: оператор заполняет прод по
  доке → `createTransport` получает `pass: undefined` → SMTP-аутентификация у провайдера падает → не уходят письма
  верификации email, сброса пароля и все уведомления из очереди `email`. Не поймано тестами: мейлер был не покрыт,
  а E2E регистрируется без подтверждения email. Закрытие: 1) канон `SMTP_PASSWORD` в `smtp.mailer.ts:70`; 2) единственная запись в `packages/shared-config/src/env.validation.ts:127` (дубликат удалён, в коде остались
  только исторические комментарии — D7 на них не реагирует); 3) `superRefine`: `NODE_ENV=production` + `SMTP_HOST` +
  `SMTP_USER` без пароля → ошибка валидации (fail-closed); 4) спек `apps/api/test/smtp-mailer.spec.ts` (6 кейсов,
  включая «НЕ читает устаревшее имя»), **с обоснованным отклонением от буквы критерия:** вместо `vi.mock('nodemailer')`
  — подмена `require()`, потому что мейлер грузит nodemailer через CommonJS `require`, а `vi.mock` подменяет
  ES-импорты (в спеке задокументировано); 5) D3 зелёный.
  **История честности (важна как прецедент):** в `main` коммитом `d9b1504` (docs-PR #51 по GAP-39) оказалась пометка
  «GAP-40 закрыт», поставленная раньше кода — в тот момент мейлер читал `SMTP_PASS`, дубликат из `env.validation.ts`
  не был удалён, спека не было, при этом строка таблицы оставалась открытой. Исправлено; позже squash #52 (с устаревшей
  базы) откатил абзац нарратива, реальный фикс приехал в #53. Урок: «закрыт» ставится только когда end-to-end работает,
  а squash с устаревшей базы может молча откатить чужие строки трекера. Строка была 4-ячеечной (критерии влились в
  ячейку статуса) — колонка была восстановлена тогда и входит в единую схему сейчас.
- **GAP-41. Дрейф «код ↔ `.env.example`»: 7 переменных читаются, но не описаны оператору. ✅ P2, закрыт 2026-09-03.**
  `GITSLOTPARK_AGENT_ID/API_TOKEN/SECRET_KEY/API_BASE`, `NOWPAYMENTS_API_BASE`, `RUKASSA_API_BASE`, `SMTP_PASS`
  (последняя ушла с GAP-40). `GITSLOTPARK_*` — 0 упоминаний в `ENVIRONMENT_VARIABLES.md`: поднимая прод по доке,
  оператор не узнаёт, что игровому провайдеру нужны ключи, и получит `PaymentProviderNotConfiguredError` на первом
  launch. Слепое пятно инструмента: docs-guard D3 сверял `.env.example` ↔ §22, но **код** ↔ `.env.example` не сверял.
  Закрытие: `.env.example` — `GITSLOTPARK_*` активными dev-плейсхолдерами `dev_gsp_*` (gitleaks-нейтрально),
  `*_API_BASE` — закомментированными overrides с дефолтом из кода; `ENVIRONMENT_VARIABLES.md` — §21 «Casino & Game
  Providers», новый §21.2 GitSlotPark (4 переменные, fail-closed поведение `creds()`, 4 бренда, риск сверки подписи →
  GAP-43), §20 деплой-чеклист, §22 зеркало `.env.example`; `env.validation.ts` не менялся (все 6 уже были в Zod-схеме).
  **Новый чек D7** в `docs-guard.yml`: извлекает `process.env.X` / `process.env['X']` / `config.get*(… 'X')` по
  `apps/api/src` + `packages/*/src`, сверяет с `.env.example` (активные и закомментированные), при расхождении —
  падение с перечнем имён; allowlist `NODE_ENV`, `CI`, `*_INTEGRATION`, `E2E_*`; временная запись `SMTP_PASS` снята
  после мержа GAP-40; отрицательный тест — фиктивный `process.env.SOME_BRAND_NEW_SECRET_VAR` → D7 FAIL.
  QUALITY_GATES: Tier 2.5 D1–D6 → D1–D7. **Попутное (найдено и починено тем же PR'ом):** (а) локальный прогон вынесен в
  версионируемый `scripts/docs-guard-local.sh` — извлекает тело шага из `docs-guard.yml` и запускает его с флагами
  runner'а (`bash -e -o pipefail`); `$HOME/dg.sh` стал тонким указателем (ручная байт-копия была причиной того, что баг
  не поймался локально; старая копия — `dg.sh.bak-manual-mirror`); (б) D3/D6 защищены от errexit-смерти (`|| true` на
  извлечениях + явный ❌ D6 при пустом списке required checks) — первая версия D7 падала в CI именно на errexit:
  `grep -vE` с пустым выводом внутри `D7_MISSING=$(…)` молча ронял весь guard до блока «итог», без `❌` и без перечня.
- **GAP-42. Верификация OAuth-подписей не покрыта тестами. ✅ P2, закрыт 2026-09-03 (PR #52).**
  `apps/api/test/oauth-verify.spec.ts` — 11 кейсов: Telegram (валидный/подделанный hash, `auth_date` > 24 ч, без
  `TELEGRAM_BOT_TOKEN` → `OAuthNotConfiguredError`/503, hash неверной длины не роняет процесс — `timingSafeEqual`
  защищён проверкой длины), Google (round-trip `buildAuthUrl`↔`verifyState`, подменённая подпись → `OAuthStateError`,
  state старше 10 мин, отсутствие state, без `GOOGLE_CLIENT_ID/SECRET` → 503). HTTP-обмен с Google не мокается —
  это runtime (GAP-46). Добавлен `apps/api/tsconfig.test.json` для typecheck'а тестов; боевые ключи не нужны —
  фиктивные секреты подставляются в `ConfigService`.
- **GAP-43. Адаптер GitSlotPark без тестов, порядок полей подписи не подтверждён. 🟡 P2, PARTIAL.**
  Тестовая часть закрыта 2026-09-03: `CALLBACK_MESSAGE_BUILDERS` экспортирован из адаптера (рефакторинг ради чистого
  теста без `as any`); новый `apps/api/test/gitslotpark-adapter.spec.ts` на фиктивном SECRET фиксирует **текущий**
  контракт: 5 операций — точная строка сообщения и UPPERCASE-hex HMAC + sanity `^[A-F0-9]{64}$`; `verifyCallback` —
  верная подпись `true`, неверная `false`, lowercase `true` (нормализация), неизвестный `x-gsp-op` `false`, без ключей
  `false` **без исключения** (fail-closed), `body === undefined` `false`; `parseCallback` — `withdraw`→`bet`,
  `betwin`/`deposit`→`win`, `rollbacktransaction`→`rollback`, `getbalance`→`balance`, `playerToken === 'uid:<userID>'`,
  первый непустой из `amount`/`betAmount`/`winAmount`; `formatErrorResponse` — коды 6/8/9/11/3/5, неизвестный → 1;
  `AMT` ровно 2 знака; `formatSuccessResponse` — status всегда 0, balance через `Number(...).toFixed(2)` (string, не
  money-helper — это контракт GitSlotPark). Смысл: после сверки с менеджером правится **только**
  `CALLBACK_MESSAGE_BUILDERS`, а тесты показывают дельту. **Не сделано:** сама сверка порядков конкатенации с
  менеджером GSP и живой раунд — это §3.2 и GAP-46 п.3; если реальный порядок иной, все seamless-колбэки провайдера
  будут отбиты как невалидные и игрок не сможет играть (ТЗ ч.4, ~60% объёма).
- **GAP-44. Фронтенд без тестов: 0 spec-файлов в `apps/web` и `apps/admin`. ✅ P3, закрыт полностью 2026-09-09.**
  Было: в `package.json` обоих только `lint`, тест-раннера нет; 18 страниц web и 14 админки защищены лишь `tsc` и
  ESLint; особенно уязвим только что сделанный GAP-36. **Этап 1 (PR #59):** vitest 2.1.9 в devDeps web+admin,
  `pnpm -r test` в CI; unit-тесты чистых функций — web `format-currency.spec.ts` (12), `wallet-helpers.spec.ts` (12),
  `api-errors.spec.ts` (8); admin `err-text.spec.ts` (4). **Этап 2:** `@testing-library/react` 16.1.0 +
  `@testing-library/dom` + `@testing-library/jest-dom` + `jsdom` 25.0.1 + `@vitejs/plugin-react` 4.3.4 (точные версии),
  vitest-конфиги на `environment: 'jsdom'` + plugin-react; DOM-тесты критериев GAP-36: `deposit-sheet.spec.tsx` (3),
  `kyc-page.spec.tsx` (3), admin `login-page.smoke.spec.tsx` (2); все сторы/API мокнуты модульно, компоненты —
  «глупый рендер». Замер 2026-10-02 по составу файлов: **18 spec-файлов web, 3 admin** (плюс 2 новых affiliate-спека);
  пересчёт 2026-10-03: admin — **4**, потому что #137 добавил `apps/admin/test/csp.spec.ts` (14 проверок CSP).
  Тогда же зафиксировано: гейты tsc ✅, `next lint --max-warnings=0` ✅ обоих, api не тронут (158 passed); lockfile
  +772 строки (testing-library/jsdom/vitejs), sentry-часть из main не изменена.
- **GAP-45. QA_CHECKLIST: 33 пункта, отмечено 0 — при этом ~9 уже проверяются машиной. ✅ P3, закрыт 2026-09-03 (PR #58).**
  E2E `player-lifecycle` закрывает register → login → KYC submit+approve → депозит по валидному HMAC (и отбой
  невалидного) → launch → bet/win → вывод с блокировкой → одобрение админом со сверкой типов проводок; часть закрыта
  unit-тестами (идемпотентность депозита, `InsufficientFunds`, NOWPayments `actually_paid`, roles-guard, lockout).
  Закрытие: у каждого пункта пометка `[auto: <файл>::<имя теста>]` или `[manual: ...]`; авто-пункты — `[x]`,
  частично покрытые — `[x*]` (код-путь закрыт, хвост боевой интеграции — GAP-46); в шапке сводка; в конце — считалка
  по разделам. **Причина отставания трекера от кода (зафиксирована как прецедент):** параллельный агент обновил
  QA_CHECKLIST.md в PR #58 (код + чеклист в одном коммите), но правило INDEX.md §6.3 не соблюл — строка трекера
  осталась не отмечена; закрыто отдельным коммитом. Счётчики чеклиста сводились с фактом трижды (PR #58 → 14/10/9,
  аудит GAP-56 п.9 → 35/10/9/16, GAP-60 п.4 → пересчёт авто-базы). **Замер 2026-10-02:** 35 пунктов — 10 `[x]`,
  9 `[x*]`, 16 `[ ]`, 24 пометки `[auto:`; сводка в шапке совпадает с фактом. Покрытие `словом`: сверка чеклиста с
  фактом ручная, гарда на неё нет.
- **GAP-46. Runtime-приёмка не выполнялась ни разу — главный блокер запуска. ⏳ P1→P0, HUMAN.**
  _Текст позиции (был физически вклеен в строку GAP-45 — с этой ревизии самостоятельная запись)._
  Ни одна внешняя интеграция не общалась с боевым контуром: HMAC проверен только на синтетических подписях,
  HTTP-клиенты — только на fail-closed. Деплоя не было: пайплайн написан и штатно скипается без секретов, миграции на
  живую БД не применялись, `seed` админа не выполнялся, SSL/nginx не поднимались. `restore.sh` **никогда не
  запускался** — непроверенный бэкап бэкапом не считается. Мониторов UptimeRobot по ТЗ ч.7 §12.2 нет (нужен домен).
  **Прогресс 2026-09-09 (NOWPayments — первый внешний контур, ключ предоставлен):** API-ключ валиден (`GET /v1/currencies`
  → 236 валют); MCP-эндпоинт отвечает (5 tools), но `/full-currencies` пока 404 — REST `/v1` (его использует
  `nowpayments.client.ts`) полностью рабочий; все 5 валют проекта поддержаны (`usdttrc20`/`btc`/`ton`/`trx`/`ltc`),
  маппинг `MAP` подтверждён (прямой тест сырого `USDT_TRC20` → 400 «alpha-numeric only», т.е. маппинг обязателен и
  корректен); `/v1/estimate` работает в обоих направлениях KYC-флоу и для maintenance-задачи курсов; `/v1/min-amount`
  = 19.2 usd→usdttrc20 (вымогать ниже нельзя — клиент должен валидировать); `price_currency` только fiat (`usd`/`eur`/`rub`),
  `usdt` как price отклонён — код уже шлёт `priceCurrency: 'USD'`, но `rub` как price для крипто-кассы зависит от
  настроек аккаунта (для MVP крипто-депозиты считаем от USD, RUB показывается через estimate); тестовый payment
  5120213360 создан, `GET /v1/payment/:id` отвечает `waiting`, `/v1/payout` доступен (адреса не настроены); IPN-секрет
  получен, каноническая подписывается нашим `verifyIPN`, подделка отбивается; Telegram-бот: токен получен, `getMe`
  отвечает, верификация виджета проверена на payload, подписанном РЕАЛЬНЫМ токеном; осталось `/setdomain` на боевой
  домен + живой логин. ❌ Реальная оплата + живой IPN на наш вебхук: требует домена и публичного URL для
  `ipn_callback_url` (сейчас example.com) — после VPS.
  **Критерий закрытия (по каждому — запись результата: дата, окружение, что именно проверено; разбор — датированным
  отчётом в `docs/archive/` по конвенции [audit-2026-08-25.md](archive/audit-2026-08-25.md)):** 1) Rukassa — создание
  платежа + приход реального вебхука → зачисление; 2) NOWPayments — `createPayment`/`estimate` + IPN с настоящей
  подписью; 3) GitSlotPark — порядок полей подписи **подтверждён менеджером** (снимает риск GAP-43), `userAuth`, sync
  каталога, зелёный seamless-раунд bet/win/rollback; 4) Google OAuth — code-flow на реальном `redirect_uri`; 5) Telegram Login Widget — бот + домен; 6) первый деплой на VPS — `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`,
  `migrate deploy`, `seed` с `SEED_ADMIN_*`, SSL, nginx, вход в админку; 7) учебное восстановление — дамп →
  `restore.sh` → проверка целостности (обязательно **до** приёма денег); 8) UptimeRobot-мониторы + cron
  `resource-check.sh`; 9) полный прогон QA_CHECKLIST на стенде; 10) **добавлено этой ревизией:** приёмка ч.8
  (партнёрская программа) по критериям A1–A25 — см. GAP-64.
  **Чего буквально нет в репозитории (проверено 2026-10-02 в этом дереве):** файла `.env` нет (только
  `.env.example`); `VPS_*` существуют только как GitHub Secrets, читаемые deploy-шагом (`ci.yml:261-275`), который
  печатает notice и скипается; домен нигде не зафиксирован — в `docker-compose.prod.yml:90,108` дефолт-плейсхолдер
  `https://casino.example.com/api/v1`, nginx-шаблон требует `DOMAIN`/`ADMIN_DOMAIN` (`${DOMAIN:?…}`); SMTP, Turnstile и
  боевые ключи PSP/GSP пусты или заданы dev-плейсхолдерами `dev_gsp_*`.
- **GAP-47. Нагрузочного тестирования нет — предел конкурентности кошелька неизвестен. ✅ P3, закрыт кодом 2026-09-03, прогнан 2026-09-27.**
  Ledger работал на Serializable-транзакциях с optimistic-lock и 3 попытками (backoff 50·n²). Закрыто:
  1. `infra/load-tests/wallet-concurrency.js` (k6) — бьёт `POST /api/v1/provider-callback/gitslotpark/withdraw`
     (seamless bet), генерирует валидный HMAC по контракту `CALLBACK_MESSAGE_BUILDERS.withdraw` (GAP-43), профили
     10→50→100 VU, threshold p95<500ms / fail<1%, кастомный warn при `status=11` (DUPLICATE_TRANSACTION);
  2. `infra/load-tests/README.md` — подготовка стенда (SQL-снипет user/wallet/game_session), env, команды;
  3. `docs/archive/load-test-TEMPLATE.md`; 4) скрипт `pnpm load-test:wallet`. **Критерий 2 (прогон на стенде)
     выполнен 2026-09-27** (локальный Docker-стенд: Postgres 16 + Redis 7, API из dist, k6 v2.3.0 в docker): деньги целы —
     баланс сходится копейка в копейку (9 916 610.00 = 10 000 000.00 − 8 339 × 10.00, version совпадает с числом
     списаний), double-spend/потеря проводок нет; но 3 retry не покрывают профиль — при 100 VU успех 30,6%
     (Serializable → Prisma P2034), p95 825 мс. Прогон нашёл и починил 4 дефекта (k6-скрипт ×2, отсутствие ретрая P2034,
     утечка текста ошибок) → GAP-57; отчёт `docs/archive/load-test-2026-09-27.md`.
- **GAP-48. Последний `eslint-disable max-lines-per-function`. ✅ P3, закрыт 2026-09-04 (PR #63).**
  `runDaily` подавлял правило и нёс `TODO(referrals): split into accrual + payout`. Оказалось устаревшим: рефакторинг
  в рамках GAP-30 уже разнёс логику в `processUserRewards`/`processCurrencyReward`, `runDaily` — 30 строк (29 зачётных
  по мерке ESLint `skipBlankLines`+`skipComments`). Контракт `{ processed, credited, date }` не изменён; репозиторий не
  содержит ни одного подавления этого правила. **Возврат подавления закрыт guard'ом G14** (Tier 2,
  `architecture-guards.yml:349`): любой `eslint-disable` этого правила роняет CI с файлом и строкой. Найдка этого
  разбора → GAP-51 (три `TODO` ссылались на закрытый GAP-22).
- **GAP-49. Юридика и комплаенс не закрыты — риск уровня «не запускать». ⏳ P0 организационный, HUMAN.**
  Лицензия, KYC/AML-политика, подтверждение 18+, обработка персональных данных (152-ФЗ/GDPR), налоги, публичные
  документы (Terms of Service, Privacy Policy, Responsible Gaming). Вне инженерной зоны, но приём **реальных** денег до
  закрытия недопустим. **Инженерная часть по ТЗ выполнена 2026-09-03:** страницы `/legal/terms`, `/legal/privacy`,
  `/legal/cookies`, `/legal/responsible-gaming` (компонент `LegalPage`, единый стиль); футер по ТЗ ч.5 §4.6
  (`SiteFooter` в `MainShell`: 18+ бейдж, условия, конфиденциальность, ответственная игра); возрастной гейт 18+ на
  регистрации (ТЗ ч.5 §16.3: чекбокс + ссылки, кнопка заблокирована до подтверждения); тексты — предварительная
  графика для приёмки UI, помечены в исходниках комментарием GAP-49; Responsible Gaming описывает работающие
  инструменты — самоисключение (24 ч минимум, 72-часовой cooloff, ревок сессий, `users.controller /me/self-exclude`),
  лимит депозита 5000 ₽ без KYC; рамка владеленческих решений — `docs/LEGAL_COMPLIANCE.md`.
  **Остаток (владелец):** в `LEGAL_COMPLIANCE.md` §2 все семь чекбоксов пусты (юрисдикция и лицензирование,
  юридически значимые тексты, AML-пороги, возрастная верификация — серверной проверки по `date_of_birth` нет, дата
  рождения собирается только в KYC, 152-ФЗ/GDPR, налоги, лицензия на сайте). Критерий закрытия: сервис не принимает
  реальные деньги до заполнения §2 и замены текстов.
- **GAP-50. Нет агрегатора ошибок (предложение, не гэп ТЗ). ✅ P2, закрыт 2026-09-04 по решению владельца.**
  ТЗ ч.7 §12.1 прямо говорит, что Prometheus+Grafana для MVP не нужны, и предписывает UptimeRobot + health-эндпоинты +
  просмотр логов; Sentry в ТЗ не заявлен — внедрение только как осознанное дополнение. Факт: без агрегатора 500-е и
  необработанные исключения видны только в `docker logs` на VPS. Протокол: 1) `@sentry/node` 8.49.0 exact, DSN
  опционален — `buildSentryOptions()` без DSN возвращает undefined, init не вызывается (в `main.ts` до NestFactory —
  ловит и ошибки бутстрапа); 2) `tracesSampleRate: 0` + `sendDefaultPii: false` + scrubPII тем же списком
  `LOG_REDACT_PATHS`, что у pino redact (SECURITY_BASELINE §12.3); 3) в Sentry — только unknown-исключения и Nest 5xx
  (GlobalExceptionFilter), AppError/4xx не отправляются; 4) `SENTRY_DSN` в `.env.example` (закомментированно) +
  ENVIRONMENT_VARIABLES §15/§22 + `env.validation` (url, optional) — D3/D7 зелёные; 5) отметка в tz-part-7 §12.
  Спек `apps/api/test/sentry-options.spec.ts` (10 кейсов).
- **GAP-51. Реферальный расчёт и уведомления читают таблицы чужих модулей. 🟡 P3, PARTIAL (переоткрыт 2026-10-02).**
  Исходная формулировка: в `referrals` GGR считается через `prisma.gameTransaction.groupBy(...)` — таблица принадлежит
  casino-модулю; в `notifications` читаются `user` и `user_settings` (модуль users) вместо `UsersFacade`. Граф
  MODULE_BOUNDARIES §15 эти зависимости **разрешает**, но как событие/порт, а не как прямое чтение чужой таблицы.
  Долг был помечен, но все три метки ссылались на `GAP-22`, закрытый 2026-08-31, — и в его критериях этой работы никогда
  не было. Третья метка (админ-агрегаты дашборда по users/payments/kyc/tickets) сознательно **не** считалась долгом:
  кросс-доменная отчётность — ответственность модуля (§13.1), берутся только read-only агрегаты, не сырые деньги.
  **Закрытие 2026-09-04 (ADR, согласовано владельцем в сессии):** рефакторинг признан некритичным — доступ read-only не
  ломает целостность, граф связи разрешает, money-контур (ledger) не трогается, а «порт» поверх единого Prisma-клиента —
  тот же SQL с лишним слоем. Вместо рефакторинга: ADR зафиксирован комментариями в затронутых репозиториях
  (рационале + условие пересмотра «вынос модуля в отдельный сервис/БД»); MODULE_BOUNDARIES §9.3 (referrals→casino:
  read-only groupBy, ADR), §11.3 (notifications→users: read-only email/settings, ADR), граф §15 приведён к факту
  (было «event»); метки `TODO(GAP-22)` убраны (PR #66); guard G1 и Tier 1 не задеты; **исходные критерии 1 и 4
  (полный port-рефакторинг + прогон integration-спека) сняты решением владельца**.
  **Что нашла сверка 2026-10-02 (почему статус PARTIAL, а не CLOSED):**
  1. критерий 1 в букве не выполнен и не может быть выполнен — проверки `grep -rn "prisma.gameTransaction" apps/api/src/modules/referrals`
     и `grep -rnE "prisma\.(user|userSettings)\b" apps/api/src/modules/notifications` не пусты:
     `apps/api/src/modules/referrals/infrastructure/referral.prisma.repository.ts:29` и
     `apps/api/src/modules/notifications/infrastructure/notification.prisma.repository.ts:57,64` — чтения на месте
     (что соответствует ADR, но противоречит тексту критерия, снятому «на словах»);
  2. ADR-комментарии лежат в `domain/*.repository.ts` (порты), а не там, где обход, — читать обоснование по месту
     нарушения невозможно;
  3. машинного гарда, который держал бы ADR в рамках («только чтение»), нет: G1 проверяет только отсутствие Prisma в
     domain/application;
  4. **глазное:** новый модуль `affiliate` сослался на ADR GAP-51 как на разрешение, но вышел за его границу — пишет в
     чужие таблицы и читает деньги. Это выделено в самостоятельную позицию GAP-62, потому что чинится не комментарием.
     **Пересверка 2026-10-03:** оба чтения живы и на `origin/main`, и на ветке #141 — `referral.prisma.repository.ts:29`
     (`gameTransaction.groupBy`) и `notification.prisma.repository.ts:57,64` (`userSettings`, `user`), то есть статус
     `PARTIAL` прежний. #141 (`feat/referrals-facade`) делает другое и не противоречит этому выводу: наружу вынесен
     `ReferralsFacade`, правило В1 сформулировано «фасад по внешним потребителям», базлайн `cross-module-imports`
     ужат 7→5 файла (maintenance переведён с прямых импортов на фасады), публичный API `admin` объявлен явно
     (`exports: [AdminFacade, AuditLogService, AdminAuthGuard, AdminAuthService]`; с 2026-10-04 guard и сервис
     живут в `AdminAuthModule`, а `AdminModule` переэкспортирует модуль — Nest не разрешает экспортировать
     провайдер чужого модуля). Внутримодульные чтения чужих
     таблиц это не отменяет — критерий «grep пустой» по-прежнему не выполнен.

### GAP-52…GAP-55 (фронтенд по ТЗ ч.5, аудит 2026-09-13…16) — досье

- **GAP-52. Фронтенд web не полностью соответствует ТЗ ч.5. ✅ P2, закрыт 2026-09-13 (branch `feat/gap52-web-tz07-frontend`).**
  Сверка кода `apps/web` с tz-part-5 (повод — вопрос владельца «фронтенд полностью реализован?»): (а) не было маршрутов
  `/favorites`, `/search`, `/providers/[slug]`; (б) профиль — одна форма данных, без вкладок Сессии/Настройки/Безопасность,
  смена пароля в UI отсутствовала, `hasPassword` (OAuth-признак) API не отдавал; (в) главная без «Продолжить играть»,
  хотя store писал `lastPlayedSlug`; (г) каталог без infinite scroll — кнопками; (д) GameCard без бейджей NEW/HOT и
  превью по «i»; (е) SEO: не было OG/title на витрине/каталоге/игре и noindex на приватных разделах; (ж) BottomNav —
  3 пункта вместо «Главная · Казино · Избранное · Профиль». Касса/кошелёк/KYC/support/referral были реализованы ранее
  (GAP-10/36/44) — гэп точечный, не «всё Part 5». Для (б) потребовались минимальные аддитивные правки API:
  `POST /auth/change-password` (ревок всех сессий кроме текущей), `DELETE /users/me/sessions` (та же семантика для
  кнопки «завершить все кроме текущей»), `hasPassword` в `GET /users/me`, `timezone` в Zod-схеме настроек (use-case
  поддерживал — поле не доходило из-за схемы). Закрыто: `/favorites` (оптимистичный add/remove, пустое состояние =
  6 популярных + «В каталог»), `/search` (недавние запросы в localStorage, пустой результат → популярные), профиль —
  4 вкладки (Данные / Безопасность — смена пароля для email-аккаунтов, OAuth пояснение без формы по `hasPassword` /
  Сессии — IP, устройство, дата, завершить одну и все кроме текущей / Настройки — email-уведомления, часовой пояс;
  push-чекбокс задизейблен до бэка, язык RU не показываем), главная — «Продолжить играть» (до 12, только
  залогиненным), каталог — infinite scroll (IntersectionObserver, скелетоны, «повторить» при ошибке), GameCard —
  бейдж NEW или HOT (не оба) + превью по «i» (провайдер/RTP/сердечко), BottomNav — 4 пункта, SEO — OG/title layout +
  динамическая `generateMetadata` страницы игры + noindex на profile/wallet/history/kyc/support/referral/favorites/
  search/deposit/withdraw. API: `POST /auth/change-password` (Zod `.strict()`, WeakPassword/InvalidCredentials/
  PasswordNotSet), `DELETE /users/me/sessions` → `{ok, revoked}`, `hasPassword`, `timezone`. Тесты:
  `apps/api/test/change-password.spec.ts` (4), web `users-api.spec.ts` (5). Проверка в момент закрытия делалась на
  Termux: tsc api 0 (своих ошибок; 2 pre-existing sentry — FUSE-обрезка `@sentry/core`, в CI не воспроизводятся),
  tsc web 0, vitest api 25/25 (lockout+roles+oauth+change-password), vitest web 38/38 unit; **остаток за CI** был
  назван честно: `next lint` (на Termux не поднимается — ajv@6 обрезан FUSE) и DOM-спеки. Не является гэпом:
  `/providers` как раздел (фильтр был в каталоге; страница — фаза 2, GAP-53), WithdrawSheet как отдельная страница
  `/withdraw` (ТЗ §19 не обязывает лист). **Остаток:** браузерная приёмка фронта — в GAP-46.
- **GAP-53. Phase 2 фронта (остаток GAP-52). ✅ P3, закрыт 2026-09-13 (branch `feat/gap53-phase2-frontend`).**
  `/providers` — сетка провайдеров (название, game_count, заглушка лого), `/providers/[slug]` — игры провайдера +
  generateMetadata («{Название} — игры провайдера | Casino»), главная — лента провайдеров последним блоком §6.1,
  профиль — аватар (превью из `profile.avatarUrl`, multipart `POST /users/me/avatar`, клиентская валидация mime/размера
  до отправки, обновление `me`). Тесты: `casino-api.spec.ts` (контракты providers/recent/favorites/toggle) + avatar-кейс
  в `users-api.spec.ts`. Фиат Phase 2 (UAH/BYN/KZT/UZS, TZ-08) сюда НЕ входит: форматирование/switcher/presets готовы,
  включение живёт за `fiatLive` в GeoConfig и ключами PSP.
- **GAP-54. Десктоп-иконпанель и глобальный вход в поиск (вынесено из GAP-53). ✅ P3, закрыт 2026-09-14.**
  (а) §4.5 — слева икон-панель 64–72px (Главная · Казино · Избранное · Провайдеры · Кошелёк · История · Поддержка):
  в коде не было вообще никакой десктоп-навигации, только мобильный BottomNav; (б) §4.4 — поля поиска не было ни в
  хедере (десктоп, Ctrl/⌘K), ни под шапкой (телефон), на `/search` не было результатов по провайдерам и last played;
  (в) §4.7 — обвязка монтировалась в корневом layout для ВСЕХ маршрутов, включая `/login` и `/register`. Закрыто:
  `DesktopNav` — фикс-панель `w-16` только с `md:`, 7 пунктов релиза, активный по префиксу сегмента, подпись по hover
  (тултип) и pin (раскрытие до 200px, состояние в localStorage — переживает reload), контент `md:pl-16`/`md:pl-[200px]`;
  запрещённые в релизе Live/Настольные/Быстрые/Бонусы не добавлены (§24); поиск — поле в хедере, лупа-ссылка на
  телефоне, `MobileSearchBar` под шапкой на главной, `Ctrl/⌘K` → `/search` (обработчик игнорирует фокус в
  input/textarea/contentEditable); `/search` дополнен результатами по провайдерам, last played и кнопкой «Сброс»;
  §4.7 — обвязка не рендерится на auth-маршрутах (`isAuthPath` по `usePathname`, НЕ через `window.location` — иначе
  hydration mismatch); листы кассы/логина остаются смонтированными, чтобы launch после входа продолжился (§5.5); чистая
  логика вынесена в `apps/web/src/lib/ui/desktop-nav.ts` и покрыта `desktop-nav.spec.ts` (13 кейсов). Регрессия
  шортката: `491d244` (#120) — Ctrl/⌘K не падает на синтетическом keydown без `key`.
- **GAP-55. Остатки ТЗ ч.5 после GAP-52/53/54 — открыто списком, «чтобы не выглядело, что фронт закрыт на 100%». ✅ P3, закрыт 2026-09-16.**
  Машинная сверка кода с tz-part-5 (2026-09-14) дала (а)–(з); закрытие по частям: (а,б) PR #83, (в,з) PR #84,
  (г,д) PR #85, (е) PR #86, (г-остаток) PR #87, (ж) PR #88.
  - **(а) фильтры в URL (§7):** состояние каталога живёт в query (`/casino?category=&provider=&sort=&q=`),
    `lib/ui/catalog-filters.ts` (чистые `parseFilters`/`filtersToApiParams`/`filtersToQuery`/`catalogHref`/`hasActiveFilters`),
    `CasinoInner` читает `useSearchParams` (Suspense-граница в `page.tsx` — без неё prerender падает, урок #80),
    `CatalogFilterBar` меняет через `router.replace`. Пустые значения не проттекают ни в API, ни в URL; кодирование —
    `%20`, а не `+` (ссылки шарятся и идут в SEO; `URLSearchParams.toString()` даёт `+` — двусмысленно для парсеров),
    чтение терпит обе формы. Добавлена сортировка (`''|popular|new|name_asc`). Сброс фильтров заработал по-настоящему
    (раньше ссылка в пустом состоянии вела на тот же смонтированный роут и состояние не менялось).
  - **(б) чипы и полки главной (§6.1):** `HomeChips` — категории из `GET /casino/categories` с фильтром по
    `game_count>0` + «Популярные»/«Новые»; полки «Новые» и «Избранное» выведены (последняя — только если не пустая);
    `GameSection variant='row'` для «Продолжить играть»; порядок полок приведён к §6.1; промо-слот сознательно ВЫКЛЮЧЕН
    (акционного движка нет — §2.8/§24 «не обещать бонус, которого нет»); `ProviderStrip` вынесен из страницы.
    Инфраструктура избранного: `hooks/useFavorites.ts` — единый кеш `['favorites-ids']` + каноничный optimistic update
    (onMutate правит кеш и захватывает снимок, onError откатывает, onSettled приводит к серверной правде); раньше главная
    и страница избранного держали по своей копии мутации и списки разъезжались. Убран хардкод-фолбэк демо-игр в
    `page.tsx` — дублировал seed с неверной формой полей и показывал карточки, которых нет в БД.
    **CI-цикл #83 и инструмент против регресса:** первый пуш покраснел на `next lint` — 2 нарушения `import/order` и
    1 реальное `react-hooks/exhaustive-deps` (`data?.data ?? []` как нестабильная зависимость useMemo → обёрнут в свой
    useMemo). Причина первых двух: предыдущая версия локального чекера молчала — брала список файлов из `git status`,
    а после коммита там остаётся только помеченное. Исправлено: `scripts/check-import-order.py` берёт `main...HEAD` +
    рабочее дерево + untracked, печатает «проверено файлов: N» (молчание больше не похоже на успех), снабжён негативным
    тестом (намеренная поломка порядка → exit 1) и нейтрален к комментариям между импортами.
  - **(в) ошибки запуска — экранами (§8.4):** маппер `lib/ui/launch-error.ts` (стабильные коды API → заголовок/текст/
    набор действий) + `components/game/LaunchErrorScreen`; страница игры показывает экран вместо toast, код ошибки
    выводится строкой «приложите в поддержку». Из §8.4 покрыты все шесть случаев: недоступна / техработы / сессия уже
    открыта / валюта не поддерживается / провайдер не ответил (сеть или 5xx) / недостаточно средств. Последнее оставлено
    флоу, а не экраном: §8.2.4 прямо велит при пустых кошельках открывать DepositSheet. У каждого экрана ≥1 действия
    (§2.3.9 «ошибка даёт следующий шаг, не тупик»); смена игры или кошелька сбрасывает ошибку. Плюс §8.3: баланс на
    планке игры обновляется `refreshActive()` по фокусу окна (Socket.IO запрещён §2.1).
  - **(з) WithdrawSheet как глобальный лист (§10.3/§16.1):** `components/wallet/WithdrawSheet.tsx` в корневом layout,
    открывается из кошелька и поверх игры; чистое ядро `lib/ui/withdraw.ts` покрывает §10.3 буквально — 1) KYC-стопер без
    формы реквизитов с одной кнопкой «Пройти верификацию», 2) «Нечего выводить» при пустых кошельках, 3) «в активной
    пусто, в другом есть» → предложить вывести ту валюту (не открывать нулевую форму). Вывод только в валюте выбранного
    кошелька и только на метод этой валюты (методы из GeoConfig, не список из головы; API enum card|sbp). Сеть крипты
    видна и не меняется; валидация адреса РАЗЛИЧАЕТ сети (TRC20 не проходит как BTC и наоборот — тесты фиксируют оба
    направления). Пресеты, минимум/максимум с символом валюты (§2.5), срок «до 24 часов», стадия подтверждения с
    замаскированными реквизитами (§16.1 ConfirmModal на вывод), результат — номер заявки + «История».
    **Попутно найден и исправлен реальный баг вывода:** страница `/withdraw` слала `destination` ОБЪЕКТОМ
    ({card_number, card_holder} / {wallet_address}), а `CreateFiatWithdrawalSchema`/`CreateCryptoWithdrawalSchema`
    ожидают строку → любой фиат-вывод давал 422, фича не работала вообще. Также она предлагала TON/TRX/LTC, запрещённые
    релизом (§24) — см. TZ-02. Отдельные страницы кассы заменены тонкими хостами (`/deposit`, `/withdraw` открывают
    лист — прямые ссылки и закладки не падают на 404): по §2.9 отдельных страниц кассы быть не должно.
    **Дедупликация (по замечанию владельца о «раздутии»):** подпись валюты была вычислена инлайном в 4 местах — сведена
    к одной `currencyLabel()` в `lib/format/currency.ts` с тестами; оболочка листа была продублирована в двух ветках
    рендера — сведена к `SheetShell`; `WithdrawSheet` разбит на `WithdrawForm`/`WithdrawPrecheckPanel`/`ConfirmPanel`/
    `DonePanel` (главная функция 238 → 143 зачётных строк при лимите 200). Тесты: `withdraw.spec.ts` 22,
    `launch-error.spec.ts` 15, +5 на `currencyLabel`. Поймано локально до отправки: собственный тест поймал ошибку в
    escape (U+02B8 `ʸ` вместо U+02BB `ʻ` в `soʻm`) — тест на формат валюты из ТЗ §2.5, а не опечатка в проде.
  - **(г) §11 — история транзакций отдельным маршрутом:** `/wallet/transactions` (защищённый, noindex наследуется с
    `/wallet`), фильтры тип / валюта / период в URL (тот же подход, что каталог: ссылка копируется, «назад» работает,
    пустое не утекает), бесконечная подгрузка «Показать ещё», ошибка — с «Повторить». Сумма всегда с валютой (§11:
    «+1 000 без валюты — ошибка UI»): `formatTxAmount` берёт знак ИЗ САМОЙ СУММЫ (ledger пишет списания отрицательными:
    `'-' + amount` в `wallet.ledger.prisma.ts`), а не из таблицы «тип → знак» — такая таблица не может разъехаться с
    новым типом проводки. Плюс/минус — зелёный/красный. Детали строки: сеть (только крипта), замороженная сумма
    (`metadata.locked_amount` у WITHDRAWAL_LOCK, где amount = 0), провайдер и внешний id из `metadata`, «баланс после»,
    id транзакции. Курс намеренно не показывается: при crypto-зачислении он не фиксировался (в metadata только
    `actually_paid`), а §11 разрешает курс «только если реально фиксировался». `/wallet` приведён к §10.1: последние
    5 операций активного кошелька + «Смотреть все».
  - **(д) §12 — история ставок:** фильтры игра / провайдер / валюта / период в URL + `/casino/history` научился
    `provider` (slug), `currency`, `from`/`to` и вернул `meta` + `stats`. Введена `roundStats` — `groupBy` по валютам, и
    список/счётчик/агрегаты строятся ОДНИМ предикатом (`roundWhere`), иначе «ставок: 124» над отфильтрованной таблицей
    врёт. Оборот и выигрыши показываются ТОЛЬКО когда выбрана одна валюта, при смешанной выборке — разбивка по кошелькам,
    суммирования ₽+USDT нет (§12). P/L — только в раскрытой детали ставки, красным-героем не вынесено (§12, §24). Деньги
    через `money`/`formatAmount`, number в проводках не появляется.
    **Попутно найден РЕАЛЬНЫЙ ДЕФЕКТ GAP-52 (в той же работе):** web-`GameDto` был описан в snake_case (`name_ru`,
    `is_new`, `is_popular`, `has_demo`), а `ListGamesUseCase` и `/casino/favorites|recent` отдают camelCase Prisma
    (`nameRu`, `isNew`, `isPopular`, `hasDemo`). Следствия: бейджи NEW/HOT (§6.4, «закрытые» в #80) ФАКТИЧЕСКИ не
    рендерились, русские названия не показывались, кнопка «Демо» на странице игры не появлялась никогда. Исправлено:
    DTO приведён к фактическому контракту, отображение вынесено в `lib/ui/game.ts` (`gameDisplayName`/`gameBadge` с
    приоритетом NEW над HOT по §6.4/§24, `gameRtpLabel` — Decimal приходит строкой, `gameHasDemo`) и ЗАКРЕПЛЕНО тестом
    `game-contract.spec.ts` — без него расхождение вернулось бы так же молча.
    **Валидация на входе:** у обоих эндпоинтов истории появились Zod-схемы запросов (`.strict()`). Раньше мусорный
    `?type=`/`?currency=` уходил прямо в Prisma, а `?from=вчера` давал Invalid Date → 500; перечисления валидируются по
    рантайм-источнику (`Object.values(LedgerEntryType)`, `Object.keys(ZERO)`), поэтому не могут разъехаться со схемой БД
    и типами. `metadata` добавлена в ответ `/wallet/transactions` (аддитивно). Тесты: api `history-filters.spec.ts` (4),
    web `history-filters.spec.ts` (15), `game-contract.spec.ts` (12).
  - **(е) §22 Performance (PR #86):** обложки игр — `GameThumb` на `next/image` (webp/avif из `formats`, `fill`+`sizes`,
    lazy) только для хостов из allowlist `NEXT_PUBLIC_IMAGE_HOSTS`; в `next.config.js` сознательно нет `hostname: '**'`
    (оптимизатор стал бы по заказу браузера ходить по произвольным URL — SSRM + отравленный кеш); собственный `/uploads/`
    идёт обычным `<img loading=lazy>` — его раздаёт nginx, а не Next, через `/_next/image` такой путь только 404-ится;
    без обложки — прежняя emoji-заглушка (витрина не пустеет); реальные хосты CDN брендов станут известны на GAP-46,
    тогда достаточно дописать в env; `lib/ui/thumbnail.ts` — чистые `parseImageHosts`/`isAllowedImageHost`/`thumbSource`,
    8 тестов (поддомены, префикс-подмена `cdn.gitslotpark.com.evil.net`, битые URL). Виртуализация длинных сеток — без
    новой зависимости: `content-visibility: auto` + `contain-intrinsic-size` на карточке (`.virtual-cell` в globals.css);
    ручной windowing на мобиле дороже его пользы для 24-карточных полок — осознанное отклонение от буквальной
    «виртуализации». Dynamic import iframe: play-страница грузит `GameFrame` через `dynamic(..., {ssr:false, loading})` —
    шапка с балансом и кнопкой кассы рисуется сразу; размонтируется с роутом (§8.4 «не держать iframe в памяти»).
    Prefetch меты игры — `router.prefetch('/casino/[slug]')` на `pointerenter`/`focus` карточки (in-view-вариант
    запульнул бы 12–24 роута первого экрана на 90% мобильном трафике; §22 формулирует как «желательно»). ISR главной —
    `/` переведена на серверный рендер с `export const revalidate = 60` (§20/§22); публичные полки приходят сервером
    через новый `lib/api/server.ts` (`fetch(..., {next: {revalidate: 60}})`, ошибки глотаются — пустая полка лучше
    упавшего prerender, и в CI API на билде не поднят); приватные полки остались клиентскими островами; бонусом —
    у главной появилась собственная `metadata`. **Отклонения, зафиксированные честно:** (1) каталог `/casino` остаётся
    CSR — «ISR каталога» из §22 несовместим с §7 «фильтры живут в URL» + бесконечной прокруткой: кэш по произвольным
    комбинациям query дал бы устаревшие выдачи при неизчезнувшем клиентском fetch; вместо ISR — `staleTime`/prefetch.
    (2) Серверную env-переменную (`API_INTERNAL_URL`) не заводил — использована существующая `NEXT_PUBLIC_API_URL`, чтобы
    не плодить расхождение с docs-guard D3/D7. (3) KYC-загрузчик вынесен не был: он грузится внутри страницы KYC, тяжёлой
    библиотеки там нет (обычный `FormData` + `fetch`) — benefit'а dynamic import нет, отметка в §22 снята с обоснованием.
    **Остаток §7 закрыт этим же PR:** на телефоне фильтры каталога — чипы категорий + bottom-sheet «Фильтры»
    (сортировка, провайдер), как требует §7, а не сайдбар; поиск и «Сбросить фильтры» доступны и на телефоне, и на
    десктопе. Тесты: `thumbnail.spec.ts` (8).
    **Динамика счётчиков web-unit по этапам этого гэпа (история, теперь не актуальна как цифра — см. §4):**
    57 → 72 (п. а/б) → 112 (п. в/з) → 135 (п. г/д) → 143 (п. е) локально, «в CI с DOM» ожидалось 118 и 149
    соответственно; фактическое число прошедших на `89881eb` в этой среде не пересчитывалось.
  - **(г-остаток) §11 «статус заявки» — закрыто 2026-09-16 (PR #87), принято владельцем делегирование «сделай как тебе
    удобно».** Проблема была не в UI, а в данных: проводка ledger не была присоединима к payment_request, поэтому
    показать статус было нечем. Решение (порядок money-пути сохранён, добавлен только предсказуемый id):
    1. `create-withdrawal.use-case.ts` генерирует `paymentRequestId` ДО блокировки и передаёт в
       `lock({ idempotencyKey: wd_lock_<prId>, metadata: { payment_request_id } })`, затем
       `create({ id: paymentRequestId, idempotencyKey: wd_<prId> })`; порядок «сначала lock, потом заявка» НЕ менялся: при
       отказе блокировки заявки нет (тест), pending-сирот не появляется; уникальность ключей та же (uuid), но
       детерминированная от id заявки — повтор по той же заявке теперь видим дедупликации (было `wd_lock_<random>`, теряющий
       связь); 2) `unlock` (отмена) и `confirmWithdrawal` (выплата) несут ту же ссылку, ключи `wd_unlock_<prId>` /
       `wd_confirm_<prId>`; 3) `GET /wallet/transactions` добирает статусы ОДНИМ запросом (`findMany({userId, id: {in}})`,
       не N+1) с обязательным scope по пользователю (IDOR) и отдаёт `payment_status`; 4) UI показывает «Статус заявки» в
       деталях строки; **строки, записанные до этого PR, остаются с `payment_status: null`** — статус не выдумывается и не
       подгоняется эвристикой по сумме/дате (это был бы расходящийся отчёт). Маппинг `PaymentStatus` → человеческий статус и
       цвета — в `lib/ui/history-filters.ts`, 4 теста. Условие пересмотра: если ledger и payment_requests когда-нибудь
       разъедутся по сервисам (см. ADR GAP-51), ссылка становится внешним ключом и потребует события, а не join. Тесты:
       `apps/api/test/withdrawal-link.spec.ts` (5: общий id в lock и create; разные id между заявками; отказ lock ⇒ нет
       заявки; KYC до мутации баланса; amount остаётся строкой).
  - **(ж) §5.2 капча после 5 неудачных входов — реализована 2026-09-16 (PR #88), решения приняты агентом по
    делегированию и зафиксированы:** 1) провайдер — Cloudflare Turnstile (бесплатно, без картинок-головоломок, виджет и
    `siteverify` не требуют SDK; обычно доступен из СНГ); замена на hCaptcha/reCAPTCHA = один файл
    `apps/api/src/modules/auth/infrastructure/services/captcha.service.ts` (другой URL + имя поля токена); 2) политика при
    недоступности провайдера — fail-open с warn в лог: капча второй слой, основной барьер уже стоит (GAP-18 lockout
    10/15 мин + GAP-19 throttler 10 req/мин на `/auth`); fail-closed превратил бы сбой Cloudflare в отказ всего логина; 3) порог 5 (§5.2), конфиг `CAPTCHA_AFTER_FAILED_ATTEMPTS`; lockout на 10 срабатывает позже — капча ДО блокировки; 4) `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY` оба optional и механизм выключен, пока задан не каждый:
    dev/CI/тесты не могут остаться без входа; 5) `remoteip` намеренно не отправляется: за nginx мы видим адрес прокси, а
    ложный IP в verification-запросе хуже отсутствия; 6) проверка ставится до argon2-verify — у бот-волны не должно быть
    шанса прогонять хеширование; `unknown email` по-прежнему InvalidCredentials (существование аккаунта капча не
    раскрывает). Фронт: `<CaptchaField>` грузит скрипт Turnstile по требованию (SDK не становится зависимостью, CSP
    `script-src … https:` его пропускает), появляется ТОЛЬКО после `CAPTCHA_REQUIRED`; store шлёт `captcha_token` только
    когда он непустой (контракт проверен тестами), `CAPTCHA_FAILED` чистит токен и просит повторить. Тесты:
    `apps/api/test/captcha.spec.ts` (9), `apps/web/test/auth-store-captcha.spec.ts` (4). **Остаётся непроверенным и
    перенесено в GAP-46:** живой `siteverify` с настоящими ключами и реальный виджет в браузере (нужен публичный
    HTTPS-домен).

### GAP-56…GAP-60 — досье (инфраструктура, лок кошелька, контракты фронта, прод-сборки)

- **GAP-56. Аудит преддеплойной инфраструктуры: 9 дефектов. ⚠️ P1, CLOSED_WORD (закрыто без прогона).**
  Повод: планирование запуска (GAP-46) при отсутствии VPS/ключей — машинная сверка `docker-compose.prod.yml` ↔
  `.env.example` ↔ `docs/ENVIRONMENT_VARIABLES.md` ↔ `infra/scripts/*` ↔ `infra/nginx/*` (2026-09-27, ветка
  `fix/gap56-infra-drift`). Каждый дефект уронил бы первый деплой, ежедневный бэкап или мониторинг с первого дня:
  1. `DB_USER`/`DB_PASSWORD`/`DB_NAME` читает compose (контейнер postgres + healthcheck), но 0 упоминаний в
     `.env.example`/ENVIRONMENT_VARIABLES — слепая зона D7 (код TS их не читает) → описаны в §3 + §22 + `.env.example` с
     требованием согласованности с `DATABASE_URL`; 2) `infra/nginx/snippets/` не смонтирован в nginx-сервис → `include
/etc/nginx/snippets/ssl.conf` падает `[emerg]` на первом старте → добавлен mount (`docker-compose.prod.yml:135`);
  2. тома `certbot_certs`/`certbot_www` compose именует с префиксом проекта (`casino-platform_certbot_certs`), а
     `ssl_init.sh` и renew-cron монтируют `docker -v certbot_certs:...` буквально → сертификаты оседают в томе, которого
     nginx не видит → томам заданы фиксированные `name:` (`:156-157`); 4) домены захардкожены (`server_name`/пути
     сертификатов ×4 в nginx conf, build-arg `NEXT_PUBLIC_API_URL` в compose, `DOMAINS=` в ssl_init.sh — править 3 файла в
     репо) → nginx conf переведён в envsubst-шаблон `infra/nginx/templates/casino.conf.template` (конвенция official-образа;
     nginx-переменные `$host` не задеты), compose передаёт `DOMAIN`/`ADMIN_DOMAIN`, `ssl_init.sh` читает их из `.env`
     (fail-closed без них), `SSL_EMAIL` опционален (дефолт `admin@$DOMAIN`); 5) `restore.sh` ссылался на несуществующие
     контейнер `casino-db`, пользователя `postgres`, каталог `/var/backups/casino`, содержал невалидный
     `DROP DATABASE x (FORCE)` (правильно `WITH (FORCE)`) и никогда не запускался (блокер GAP-46 п.7) → переписан:
     контейнер через `docker compose ps -q postgres`, имена из `DB_USER`/`DB_NAME` (source `.env`), `--dry-run`,
     `gunzip -t` до изменений, `psql -v ON_ERROR_STOP=1`, миграции и проба `/health/ready` после заливки;
  3. `postgres-backup.sh` (cron 02:00) — молчаливые дефолты `${DB_USER:-casino}`/`${DB_NAME:-casino_prod}` могли
     разойтись с реальными именами БД → ночной бэкап падал или снимал пустую БД → `source .env` + fail-closed;
  4. `health-check.sh` и `resource-check.sh` пробовали `http://localhost:3001` с хоста — порт api не публикуется
     (наружу только nginx 80/443) → проба падала всегда, `resource-check` ALERT'ил бы каждые 5 минут → проба перенесена
     внутрь контейнера api (`compose exec api wget`, wget есть в образе — им же работает healthcheck compose);
  5. `rollback.sh` звал `pm2 reload` и `pnpm build` — на VPS их нет, деплой идёт docker-образами → приведён к
     `docker compose build api web admin` + `up -d` + health-check по DEPLOY.md; 9) считалка `QA_CHECKLIST.md` разошлась с
     фактом (было 33/7/17, факт 35/10/9/16, 26 спеков вместо 22) → сведена.
     **Гейты того PR:** `bash -n` по всем скриптам, docs-guard локально (D1–D7), commitlint; typecheck/lint/tests не задеты
     (нет TS-изменений). Побочные проверки envsubst-механики (nginx official image: `/etc/nginx/templates/*.template` →
     `/etc/nginx/conf.d/`, envsubst только по определённым env-именам) — задокументированы в шаблоне и compose; живая
     проверка — на первом деплое.
     **Почему `CLOSED_WORD` (решение этой ревизии):** ни один из девяти фиксов не был исполнен — проверялся только синтаксис
     shell и наличие строк в YAML. Живого прогона `docker compose config`/`up` никто не делал. Прогноз сработал: через
     4 дня аудит GAP-59 нашёл **10-й дефект того же класса** (прод-сборки web/admin не собирались ни разу; чинили #128 и
     `7bc3598`), а GAP-60 расширил CI-гейт так, чтобы класс ловился машиной. Пункт «живой деплой» остаётся в GAP-46 п.6.
     **Что добавила сверка 2026-10-03:** #137 (`fbe980d`) нашла и закрыла ещё шесть дефектов того же класса — они
     вынесены в самостоятельную позицию GAP-69, чтобы не расширять задним числом список «девяти»; строки
     `docker-compose.prod.yml` в колонке `Подтверждение` после перезаписи compose поехали (snippets — теперь `:197-199`,
     именованные тома — `:213-221`). Класс nginx-заголовков с #137 закрыт гардом `check-nginx-header-inheritance.sh`,
     но живого `docker compose config`/`up` с заполненным `.env` по-прежнему не было → статус `CLOSED_WORD` сохраняется.
- **GAP-57. Конкурентные мутации одного кошелька не сериализовались приложением. ✅ P1, закрыт 2026-09-30 (ADR + прогон).**
  Найдено прогоном GAP-47: при 100 VU на одного игрока 69% ставок получали отказ (Prisma P2034 — Serializable write
  conflict на commit). Версия «нашёл и починил» (PR 2026-09-27): 1) `withRetry` в ledger ловил только app-level
  `OptimisticLockError` — P2034 приходил от СУБД ДО app-кода и не ретраился; 2) `PrismaWalletTransactionRunner.runInTransaction`
  (единственная точка открытия внешних транзакций bet/win/rollback) не ретраил вовсе; 3) текст сырой Prisma-ошибки (с
  путями машины) утекал провайдеру в HTTP-ответе коллбэка; 4) k6-скрипт был неисполняемым (чейнинг `update()` в
  k6/crypto + `discardResponseBodies`). Остаток после того PR — 3 retry не покрывали профиль (30,6% успеха).
  **ADR (решение владельца 2026-09-30) — вариант 1, advisory-лок:** конкурентный abort заменён явной очередью —
  `pg_advisory_xact_lock(hashtextextended('casino.wallet:<userId>:<currency>',0))` ПЕРВОЙ операцией транзакции, до
  чтения `wallet_accounts`; isolation `ReadCommitted` (лок сам сериализует кошелёк — SSI отменял бы в том числе
  неконфликтующие транзакции); `lock_timeout` (env `WALLET_LOCK_TIMEOUT_MS`, дефолт 5 с) — всплеск на одном кошельке не
  выедает пул соединений; повтор 5 раз с джиттером на P2034/55P03/`OptimisticLockError`. Почему не варианты 2/3:
  per-wallet очередь BullMQ вносит асинхронность в путь денег (провайдер ждёт ответа на ставку синхронно),
  in-process mutex не работает при >1 инстансе API. **Контракт:** `runInTransaction` принимает `WalletLockTarget`
  (userId+currency) — забыть сериализацию нельзя на уровне типов; `bet`/`win`/`rollback` передают кошелёк игрока; оба
  «денежных» пути (solo credit/debit и lock/unlock/confirm) идут через одну примитиву `runWalletTransaction`.
  **Критерий закрытия выполнен:** прогон 10/50/100 VU — успех 100% (25 708/25 708) против 30,6% в базовом; баланс сошёлся
  копейка в копейку (10 000 000 − 10 797×10 = 9 892 030; version 10 798 = 1+10 797; ledger 1:1). Параллелизм доказан:
  10 кошельков → 165 rps / p95 169 мс (против ~82 rps одного кошелька) — лок пер-кошелёк, не глобальный. Кривая
  латентности одного кошелька (1 VU → p95 21 мс … 100 VU → 1.16 с) линейна и означает очередь, а не отказ; прежний порог
  `p(95)<500` требовал параллелизма от последовательного ресурса и заменён санитарным `<2000` мс. **Попутно исправлены
  две ловушки:** (1) `pg_advisory_xact_lock` возвращает `void`, который Prisma не десериализует в `$queryRaw` — поймано
  интеграционным тестом на реальном Postgres, приведено к `::text` (`wallet-transaction-lock.ts:130,150`); (2) порог k6
  `http_req_failed` был слеп к дефекту (отказы шли как HTTP 200 + `{status:1}`, k6 показывал 0.00% при 69,4% отказов) —
  главный гейт перенесён на `checks: rate>0.99`. Регрессия зафиксирована тестом на реальной БД: 20 параллельных списаний
  одного кошелька — все проходят, баланс и `version` сходятся. Отчёт: `docs/archive/load-test-2026-09-30.md`.
  Следствие для документации: README строка «Optimistic locking … retry ×3» стала ложью — это часть GAP-16.
- **GAP-58. Аудит контрактов фронт↔API (~40 эндпоинтов): 5 сломанных мест. ✅ P1, закрыт 2026-09-27.**
  Повод: первый локальный запуск (сессия GAP-47/56) поймал креш главной (`/casino/recent` двойная вложенность, исправлен
  в фиксах #94) — владелец поручил систематическую сверку «форма ответа API ↔ ожидания web/admin» по всем потребляемым
  эндпоинтам (метод: контроллер-факт с учётом ApiResponse-обёртки ↔ DTO/развороты фронтов). Дефекты были закодированы
  номерами 1–5 без GAP-id — с этой ревизии позиция имеет ID, а нумерация осталась в досье:
  1. **Админка: ВСЕ листинги сломаны** — `/admin/users`, `/withdrawals`, `/payment-requests`, `/transactions`,
     `/audit-logs`, `/games` отдают `{items, meta}`, а клиент читал `data.data` как массив → `data.data.map is not a
function`, pager total=0; `/admin/kyc` — `{items, total}`; `/admin/support/tickets`, `/admin/referrals` — ключ `data`
     → нормализация конвертов в `apiGetFull` (`apps/admin/src/lib/api.ts:52-72`, `unwrapListPayload`), страницы не тронуты;
     спек `apps/admin/test/api-get-full.spec.ts` (5).
  2. **Админ-логин при неверном пароле возвращал «успех»**: `{success:false, error}` с HTTP 200 (interceptor пропускал
     объект с ключом success) → клиент получал `data: undefined`, вход «проходил» без токена; то же для `POST /admin/admins`
     и `/:id/deactivate` не-superadmin'ом (403-ситуации показывались как успех) → HTTP 401/403 + стандартный error-конверт
     (`admin-auth.controller.ts:44`, `admin-admins.controller.ts`); спек `apps/api/test/admin-contract.spec.ts` (4).
  3. **`/users/me` в `hydrate()`**: ответ `{user, profile, settings, kycStatus}` записывался целиком в `user` → после
     перезагрузки у `user` нет id/email/role (тихая порча; спасало только `Boolean(user)`) → берём `me.user`
     (`apps/web/src/stores/auth.ts:101`); спек `auth-store-hydrate.spec.ts` (3).
  4. **Блок «Причина отказа» на `/kyc` никогда не показывался**: клиент ждал `rejection_reason`, API отдаёт camelCase
     `rejectionReason` → поле сведено с фактом (`apps/web/src/lib/api/kyc.api.ts:8-12`); кейс в `kyc-page.spec.tsx`.
  5. **`/referrals/list` — тип описывал несуществующие ключи** (`status`, `created_at`); API отдаёт
     `{id, registered_at, is_active, total_earned, currency}` — запрос мёртвый (`void list`) → тип приведён к факту
     (`apps/web/src/types/referral.ts`, `app/referral/page.tsx`).
     Остальное (~30 эндпоинтов: casino/wallet/payments/auth/kyc/support/referrals/geo/admin-dashboard) — контракты сходятся;
     `/admin/kyc/:id` с 200-ошибкой при отсутствии записи помечен как сомнительное место (потребителя нет — переделать при
     появлении). **Шестое место нашлось позже и закрыто #135** (`b514c39`, в `main`): `/admin/settings` и
     `/admin/notifications/send` отдавали 404 не из-за формы конверта, а потому что контроллеры и токены сервисов вообще
     не были подключены к `AdminModule` (зародыш — #121) — вынесено в позицию GAP-67. Гейты на момент закрытия: web 161 passed, admin 11 passed, api 195 passed / 21 skipped, typecheck/lint 0 по
     всем трём apps, commitlint OK — цифрам этого абзаца верить нельзя (см. §4: они разошлись с README и шапкой файла).
- **GAP-59. Аудит проекта перед запуском: прод-контур, дубли спеков, счётчики. ✅ P1, закрыт 2026-10-01 (PR #128).**
  Метод: локальный прогон всех гейтов, сборка standalone-образов web/admin, сверка compose ↔ prod-Dockerfile ↔ бандлы
  фронтов, `vitest list` на коллекции спеков. Позиции отчёта (были без ID):
  1. **прод-compose не передавал build-arg `NEXT_PUBLIC_API_URL` сервису `admin`** (у `web` был, у `admin` секции `args:`
     не было); `admin.prod.Dockerfile` объявляет `ARG NEXT_PUBLIC_API_URL=https://casino.example.com/api/v1` — в образ
     уезжал дефолт. `apps/admin/src/lib/api.ts` — axios `'use client'` с `baseURL`, все 20 страниц дашборда клиентские,
     серверного прокси в admin нет; nginx-vhost admin не имеет `location /api/` → абсолютный URL обязателен. Итог: на любом
     домене, отличном от `casino.example.com`, бандл админки ходил на чужой/несуществующий хост — админ-логин сломан в проде.
     Эмпирика: две сборки одного кода с разным `NEXT_PUBLIC_API_URL` дали разные литералы в `.next/static/chunks/**` —
     Next.js инлайнит `NEXT_PUBLIC_*` на сборке, `env_file` на build не влияет. CI не ловил: job `docker-build` собирал
     только `api.prod`. Фикс: `args: NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-…}` как у `web`
     (`docker-compose.prod.yml:108`) с комментарием-предупреждением про запекание.
  2. **Guard'а на этот класс дрейфа не было** → новый guard **G23** (`.github/workflows/architecture-guards.yml:432`,
     `scripts/check-prod-build-args.sh`): каждый `ARG` (кроме `_*`) из `*.prod.Dockerfile` обязан приехать через `build.args`
     сервиса, который его собирает; отрицательный тест — с откатом фикса guard падает с внятным ❌ и именем переменной.
  3. **5 спеков affiliate продублированы в двух каталогах** (`src/modules/affiliate/__tests__/*.use-case.spec.ts` и
     `src/modules/affiliate/application/use-cases/*.use-case.spec.ts`: attribute-player, clawback-player-commissions,
     create-commission, credit-commission, track-click) — содержимое идентично, отличаются только пути импортов;
     `vitest list --filesOnly` собирал обе копии, прогон пары файлов давал 24 теста = те же 12 имён дважды; каждый CI-прогон
     гонял ~68 тестов дважды, правка одной копии молча оставляла вторую устаревшей. Фикс: оставлены колокейшн-копии (в этом
     модуле новый стиль — спек рядом с кодом: login-affiliate, qualify-attributions, register-affiliate, affiliate-daily-run
     существуют только там), из `__tests__/` остались уникальные affiliate-jwt.service, affiliate-settings, ngr-calculator;
     affiliate 236 → 168 тестов (17 → 12 файлов).
  4. **Счётчики тестов в README отстали** (заявлены 157 web / 203 api) → пересчитаны: web 177, admin 11, api 468
     unit/integration (406 прогнано локально + 62 в 12 файлах интеграций/E2E на БД — в CI; локально не стартуют,
     `binaries.prisma.sh` недоступен). Замечание этой ревизии: это четвёртое по счёту «сведение счётчиков», и оно тоже
     разошлось (см. §4).
- **GAP-60. Аудит проекта, п.3 «хрупкость и гигиена». ✅ P2, закрыт 2026-10-02 (коммит `5d2bd67`).**
  Продолжение GAP-59 (владелец выбрал пункт 3 остатков — пять подпунктов + найденный шестой):
  1. `docker-build` собирал только `api.prod` и только на push в main (`if: github.ref == 'refs/heads/main'`) — поэтому
     дефекты прод-сборок web/admin из GAP-59 не ловились CI и доехали бы до деплоя → job собирает все три прод-образа
     (api/web/admin) и на PR, и на main; web/admin получают явный `build-args: NEXT_PUBLIC_API_URL` — ровно как compose
     (`ci.yml:206-222`);
  2. `next/font/google` тянул Inter из fonts.googleapis.com во время `next build` — сетевой отказ ронял сборку прод-образа
     web (воспроизведено локально: «Failed to fetch Inter from Google Fonts») → Inter самохостын:
     `@fontsource-variable/inter/wght.css` в `apps/web/src/app/layout.tsx:10`, семейство `'Inter Variable'` проброшено в
     прежнюю переменную `--font-inter` (globals.css) — Tailwind и типографика не изменились; проверка: сборка web зелёная БЕЗ
     доступа к Google Fonts, в `.next/static/media` лежат 7 woff2, `.next/standalone/apps/web/server.js` на месте;
  3. базлайны техдолга отстали (CI сыпал WARN «часть базлайна погашена», реестр держал замеры 2026-09-27) → ужаты
     `use-case-specs` (33→28) и `nest-exceptions` (5 файлов→4), `pnpm-audit` (high 20→19, moderate 28→27); замеры G16–G20
     пересчитаны; все шесть ратчетов + audit — OK без WARN. Позже этот же базлайн обнулила #134 (`89881eb`) — детали в
     [TECH_DEBT.md](TECH_DEBT.md);
  4. `QA_CHECKLIST.md` заявлял 203 api / 157 web → пересчитано (api 403 unit/integration в прогоне без БД + 12 файлов
     интеграций/E2E в CI; web 177; admin 11), разбивка пунктов 10/9/16 сверена — верна (подтверждено этой ревизией: 35
     пунктов, 10 `[x]`, 9 `[x*]`, 16 `[ ]`);
  5. **GAP-29 был закрыт по лживому детектору** — см. досье GAP-29 (детектор D3, 6 настоящих переменных, спек паритета);
  6. **прод-образы web/admin не собирались ни разу — и не из-за одной причины.** Первым прогоном расширенного docker-build
     (п.1) сборка `web` упала на `pnpm --filter @casino/web build`. Локальное воспроизведение в scratch-копии контекста
     (ровно COPY-набор Dockerfile) дало две независимые причины: (а) корневой `.eslintrc.js` не копировался —
     `apps/web/.eslintrc.js` его не расширяет, а наследует обходом вверх, поэтому `next lint` (шаг `next build`) парсил
     `.ts` как скрипт: 129 × «Parsing error: The keyword 'import' is reserved»; (б) `.npmrc` (`node-linker=hoisted`) не
     копировался — pnpm изолировал транзитивную `decimal.js` из `@casino/shared-utils` → «Cannot find module 'decimal.js'»
     (ровно тот класс, что `api.prod.Dockerfile` уже документировал для node-типов). `admin` — тот же дефект (31 parsing-ошибка).
     Фикс: `COPY .npmrc .eslintrc.js ./` в `web.prod.Dockerfile` и `admin.prod.Dockerfile` с комментарием-расследованием;
     `packages/` в рантайме не нужны — `tsconfig paths` мапят `@casino/*` на `src`, код инлайнится в бандл. Проверка: scratch
     по новому COPY-набору — оба образа собираются, `.next/standalone/apps/{web,admin}/server.js` на месте.

### GAP-61…GAP-66 — Партнёрская программа (ТЗ ч.8), досье новой группы

> В реестре эта часть ТЗ не была описана никогда: при целом модуле, двух миграциях и четырёх PR
> (#105 — сам модуль, #119 — честная расшифровка начисления и ярлык «Игроков», #123 — контракт кабинета держится тестом,
> #128 — снятие дублей спеков) в файле не было ни одной строки про affiliate. Замер 2026-10-02:
> 46 файлов в `apps/api/src/modules/affiliate`, 13 env-переменных в `.env.example` (§ Affiliate, строки 128-153),
> 3 задачи планировщика (`apps/api/src/modules/maintenance/application/affiliate-daily.job.ts`,
> `affiliate-qualification.job.ts`, `affiliate-clicks-cleanup.job.ts`), 6 страниц админки
> каталог `apps/admin/src/app/dashboard/affiliate` — страницы: index (сводка), `partners`, `partners/[id]`,
> `commissions`, `attributions`, `settings`),
> кабинет партнёра (`apps/web/src/app/affiliate/(cabinet)/{dashboard,commissions,players,links,settings}`,
> `login`, `register`, публичная страница, `components/affiliate/AffiliateCodeCapture.tsx`).

- **GAP-61. Ядро ч.8 реализовано. ✅ CLOSED.** Регистрация партнёра (отдельная сущность `affiliates`, свой JWT
  `aud='affiliate'`, `apps/api/src/modules/affiliate/infrastructure/affiliate-jwt.service.ts`), трек-ссылка + deep-link,
  endpoint клика с записью в БД, cookie и редиректом (`affiliate-tracking.controller.ts`, `Throttle` с
  `THROTTLE_AFFILIATE_TRACKING_LIMIT`), привязка игрока при регистрации, ежедневный расчёт NGR/RevShare и начисление на
  кошелёк партнёра (`affiliate-daily-run.use-case.ts`, `credit-commission.use-case.ts`), кабинет и admin-API/UI,
  антифрод F1–F3, самоисключение, аудит-лог admin-действий. NGR-математика: `domain/value-objects/ngr-calculator.ts` —
  `ggr = bet_sum − win_sum − rollback_sum`, `ngr = ggr − bonus_sum − provider_fee_sum`; отмены (`rollback`) вычитаются
  отдельно, риск R4 ТЗ §20 («двойной вычет / занижение NGR») закрыт реализацией. Идемпотентность начислений — уникальный
  индекс `@@unique([affiliate_id, player_id, period_start, currency])` (миграция `20260929171538_affiliate_program_initial`).
  Покрытие: 12 spec-файлов модуля + `apps/api/test/affiliate-cabinet-contract.spec.ts` (контракт кабинета) +
  `apps/web/test/affiliate-commissions.spec.tsx`. **Чего не было:** собственной строки в этом реестре (дефект учёта, а не
  кода) — исправлено этой ревизией.
- **GAP-62. Affiliate пишет в чужие таблицы и читает деньги под ярлыком ADR GAP-51. 🔴 OPEN, P2.**
  ADR GAP-51 разрешает **только чтение** и только для referrals/notifications («money-контур не трогаем»). Факт:
  1. записи в чужую таблицу — `apps/api/src/modules/affiliate/infrastructure/player-provisioning.prisma.repository.ts:23`
     (`prisma.user.create`) и `:38` (`prisma.user.delete`) + чтение `kycProfile` (`:50`) и `userSettings`
     (`affiliate.prisma.repository.ts:478`); 2) чтение денег — `affiliate.prisma.repository.ts:842` (`prisma.walletAccount.findMany`)
     и `:852` (`prisma.ledgerEntry.groupBy`), плюс `:798` (`prisma.gameTransaction.groupBy`); 3) ссылки на GAP-51 при этом
     стоят в `domain/repositories/affiliate.repository.ts:233,293,354` и в `affiliate.prisma.repository.ts:474,782`, то есть
     расширение мандата оформлено комментарием там, где его никто не принимал. Аргумент «общий Prisma-клиент — тот же SQL»
     для **записи** в `users` и для чтения **балансов** не работает: это другой класс риска (целостность денег и жизненный
     цикл пользователя). Что нужно: либо явное решение владельца о расширении ADR (тогда — пункт с условиями пересмотра в
     MODULE_BOUNDARIES), либо порты `UsersFacade`/`KycFacade`/`WalletFacade` и снятие ссылок на GAP-51. Смежное (не
     дублируем): мутации из presentation в `affiliate-admin.controller.ts:175,224` и `affiliate.controller.ts:285,303`
     учтены как В3 в [TECH_DEBT.md](TECH_DEBT.md); класс-импорты `AffiliateJwtService`/`ip-hasher` в application — В5 там же.
     **Сверка 2026-10-03 — почему позиция осталась `OPEN`, а не `PARTIAL`:** #139 (`5fdb2fb`, ветка в ревью, не в `main`)
     провела affiliate-мутации через use-case'ы (В3 по модулю закрыт: `affiliate-admin.controller.ts:175,179,224` и
     `affiliate.controller.ts:285,303` → 5 use-case), но **запись в `users` оставила намеренно и описала это точно**.
     В шапке `apps/api/src/modules/affiliate/infrastructure/player-provisioning.prisma.repository.ts` (проверено
     `git show origin/refactor/admin-finance-affiliate-support-writes:casino-platform/apps/api/src/modules/affiliate/infrastructure/player-provisioning.prisma.repository.ts`,
     переключаться между деревьями не требовалось) перечислены три метода `UsersFacade`, без которых запись некому
     вернуть владельцу:
  1. `UsersFacade.provisionAffiliatePlayer(input: { referralCode: string }): Promise<{ id: string }>` — создаёт
     служебную user-запись партнёра и отвечает за уникальность кода;
  1. `UsersFacade.deprovisionAffiliatePlayer(userId: string): Promise<void>` — компенсирующее удаление сироты;
  1. опционально `UsersFacade.isReferralCodeAvailable(code: string)` — тогда из affiliate уйдёт и чтение `users.referral_code`.
     Публичный API модуля `users` — `exports: [UsersFacade, SelfExclusionUseCase]` — ни создания, ни удаления учётной
     записи не отдаёт, поэтому «убрать запись в этой волне нельзя». На ветке #139 обходы сдвинулись: запись —
     `player-provisioning.prisma.repository.ts:51,71`, чтения денег — `affiliate.prisma.repository.ts:855,865`
     (на `origin/main` — `:23,38` и `:842,852`). Закрытие GAP-62 — вход в волну В1 (модуль `users` ведёт другой агент),
     решение владельца о расширении ADR не требуется: достаточно методов фасада.
- **GAP-63. Антифрод F4 (депозит ровно на порог). 🟩 CLOSED 2026-10-05, был P3.**
  ТЗ ч.8 §13.2 требует помечать атрибуцию в `reject_reason`, если депозит в пределах 1% от
  `affiliate_min_deposit` (классический признак «минималки»), не блокируя её. Реализовано на квалификации, а не на
  атрибуции: в момент клика депозита ещё нет, а правило смотрит ровно на него. Коридор —
  `deposit-threshold-band.value-object.ts` (`isNearThresholdDeposit`; порог 0 отключает правило, потому что 1% от
  нуля — тоже ноль). Сравнивается `amount_rub` **первого** депозита, а не накопленная сумма: «закинул минималку» и
  «накопил минималку тремя платежами» — разные сигналы. Про имя токена: §13.2 пишет `needs_review`, в справочнике
  причин (§11.4, `AFFILIATE_REJECT_REASONS`) для этого правила зарезервирован `near_threshold_deposit` — он называет
  сработавшее правило, а `needs_review` в справочник не входит, поэтому взято имя из справочника. «Не блокировать»
  выдержано буквально: `status` остаётся `qualified`, `reject` не вызывается, `listQualifiedForCalc` фильтрует по
  статусу и в причину не смотрит → комиссия начисляется как обычно. Разбор (§13.3): админский список атрибуций
  принимает фильтр `reject_reason` (Zod-схема по справочнику: неизвестный код — 400, а
  не пустая страница, иначе опечатка в фильтре выглядела бы как «флагов нет»). Кабинет партнёра причину на
  квалифицированной строке не отдаёт — для партнёра колонка означает «почему отказали», и читать из неё обвинение
  нельзя; настоящая причина отказа показывается как раньше, партнёр может оспорить. Флаг — не блок и не отчёт:
  живого партнёрского депозита по-прежнему не было (GAP-46), сценарии A1–A25 не прогонялись (GAP-64).
- **GAP-64. Критерии приёмки ч.8 (A1–A25) не прогонялись end-to-end. 🟦 CODE_DONE, P1.**
  ТЗ ч.8 §19 задаёт 25 сценариев (A1–A11 — клик/атрибуция/антифрод, A12–A19 — ставки, NGR, идемпотентность и кредит,
  A20–A25 — авторизация, kill-switch `AFFILIATE_ENABLED`, `revshare_rate` из `system_settings`, запрет самосмены ставки,
  разделение JWT `aud`, cleanup кликов). Юниты и контрактные спеки модуля их частично моделируют (в т.ч. дедуп
  `affiliate-daily`, отказ при отсутствии ключей), но ни разу не проверялись: живой клик с cookie и редиректом,
  deep-link `?p=casino/<slug>` и отбрасывание `?p=https://evil.com` (A6 — отсутствие open redirect), реальный
  `POST /affiliate/track` через nginx, кредит на кошелёк партнёра в связке с ledger, одновременный запуск daily (A16 —
  `P2002` и пропуск). В чек-листе GAP-46 пункт «партнёрская программа» отсутствовал — добавлен как критерий 10.
- **GAP-65. `provider_fee_sum` всегда 0. ⚖️ ACCEPTED, P3.** ТЗ §20 риск R2: комиссии game-провайдеров в системе нет →
  NGR завышен на 2–8% относительно отраслевой практики. Зафиксировано в
  `apps/api/src/modules/affiliate/README.md:67`; расчёт допускает непустое значение (`ngr-calculator.spec.ts`
  проверяет ветку с `providerFeeSum: '200'`), так что включение — данных провайдера, а не код. Решение владельца — Q4
  (GAP-66).
- **GAP-66. Открытые вопросы владельца по ч.8. ⏳ HUMAN, P2.** ТЗ §20 «Открытые вопросы к владельцу»: Q1 — реализовывать
  ли блокировку самоисключённых при атрибуции в MVP (риск R1: сейчас `login.use-case.ts:94` блокирует вход → NGR = 0 →
  комиссии нет, ущерб ограничен, но проверка при атрибуции отсутствует); Q2 — страховой депозит (safety net) 20%
  начислений в первые 30 дней; Q3 — минимальная сумма вывода для партнёра (без ограничений по общим правилам KYC или свой
  порог); Q4 — учитывать ли `provider_fee` при появлении данных (автоматически или настройкой). Плюс риски R3 (открытая
  регистрация партнёров без модерации — митигирована F1–F4, пересмотр при >100 партнёров) и R8 (отсутствие hold-периода:
  инфраструктура статусов готова, флаг в фазе 2).

### GAP-67…GAP-70 — досье волны #135…#141 (сверка 2026-10-03)

- **GAP-67. Admin-эндпоинты настроек и рассылки не были зарегистрированы. ✅ CLOSED (P0, #135 = `b514c39`).**
  Зародыш — #121: появились `AdminSettingsService`/`AdminBroadcastService` с портами-токенами
  (`SYSTEM_SETTING_REPOSITORY`, `ADMIN_BROADCAST_REPOSITORY`), но токены остались без провайдеров, а
  `AdminSettingsController`/`AdminNotificationsController` — без места в `controllers[]`. Итог в рантайме:
  живой 404 на `/admin/settings` и `/admin/notifications/send` при зелёном CI — DI-граф проверяется только
  поднятым приложением. Закрыто регистрацией в `apps/api/src/modules/admin/admin.module.ts:34-35,41-48`
  и спеками `apps/api/test/admin-module-wiring.spec.ts` (7 кейсов: токены → Prisma-реализации, сервисы в
  providers, оба контроллера в `controllers`) и `admin-system-services.spec.ts` (8 кейсов поведения настроек
  и рассылки). Число кейсов — по `grep -c '  it('`, прогона в этом дереве не было.
- **GAP-68. У админки не было CSP. ✅ CLOSED (P1, #137 = `fbe980d`).** Самая привилегированная поверхность
  (логин по admin-JWT, финансовые операции) жила без policy-заголовков: ни middleware, ни заголовков в
  ADMIN-vhost. Добавлены `apps/admin/src/lib/csp.ts` + `apps/admin/src/middleware.ts` +
  `infra/nginx/snippets/security-headers.conf` (nginx отдаёт их сам, чтобы не дублировать на двух слоях).
  Осознанно **без** `strict-dynamic`/nonce: ровно такой же эксперимент (`d201c1e`) уже сломал фронт — при
  статической сборке не исполнялся ни один из 514 `<script>`, потому что nonce появляется только при SSR.
  Инвариант «CSP ↔ режим рендеринга» держит `apps/admin/test/csp.spec.ts` (14 проверок по тексту #137).
  Проверка браузером на живом домене — остаток GAP-46 (п.9).
- **GAP-69. Дефекты первой выкатки, найденные до первого `up`. ✅ CLOSED (P1, #137).** Шесть мест, где
  зелёный CI не гарантировал, что стек поднимется: (1) `postgres-backup.sh` был смонтирован в
  `/docker-entrypoint-initdb.d/` — файлы оттуда выполняются на ПЕРВОМ старте с пустым томом, а скрипт под
  `set -euo pipefail` зовёт `docker ps`/`docker exec` внутри postgres-контейнера, где docker CLI нет →
  инициализация БД падала; mount убран, бэкап остался cron'ом на хосте; (2) `location /uploads/avatars/`
  со своим `add_header` по наследованию nginx терял все прочие security-заголовки → вынесено в сниппет,
  класс закрыт проверкой `infra/scripts/check-nginx-header-inheritance.sh` (job `lint-typecheck-test`,
  ci.yml:173); (3) у web/admin/nginx не было healthcheck'ов, `depends_on` — без `condition: service_healthy`,
  из-за чего `up -d` «зеленел» при 502 от nginx (`docker-compose.prod.yml:111-116,147-150,172-179`);
  (4) `exec -T api npx prisma migrate deploy` не находил схему (schema в `packages/database/prisma`,
  поля `prisma` в `package.json` нет, pnpm в runtime-стадии нет) → явный `--schema`
  (`infra/scripts/deploy.sh:14-15`); (5) `.env.production` не попадал под `.gitignore` (были только `.env`
  и `.env*.local`), хотя `docs/DEPLOY.md` §Первичная настройка велит создать именно его → паттерны `.env` +
  `.env.*` (`casino-platform/.gitignore:14-15`) и усиленный `scripts/bin/check-staged-paths`; (6) job `deploy`
  при непроставленных `VPS_*` давал зелёный статус, читавшийся как «выкатка прошла» — теперь факт
  «выкатки не было» пишется заголовком в summary, а `deploy` выведен из обязательных чеков ruleset.
  **Что НЕ закрыто этой позицией:** сама выкатка и `docker compose config` с заполненным `.env` — GAP-46 п.6.
- **GAP-70. CVE-долг prod-контура. 🟡 PARTIAL (P1, #140 = `ba271cc` + `c3220c9`, ветка в ревью).**
  Механизм, а не цифры: храповик `scripts/audit-ratchet.mjs` читал `report.metadata.vulnerabilities`, которое
  pnpm пересылает с реестра НЕфильтрованным, тогда как `pnpm.auditConfig.ignoreGhsas` применяется только к
  `report.advisories` (проверено автором на pnpm 9.12 и 11.7). Следствие: список из 50 GHSA в `package.json`
  не заглушал ничего, и «3 critical» в базлайне были вечными независимо от мьута. Починено: считаем по
  `advisories`, mute-лист перечитывается из манифеста и применяется повторно (идемпотентно), добавлена
  канарейка полноты отчёта (обрезанный отчёт → rc=2). Триаж: 23 advisory сняты точечными overrides
  (транзитивные `lodash`, `postcss`, `qs`, `uuid`, `@mapbox/node-pre-gyp>tar`), overrides 2→7, из mute-листа
  убраны id исправленных пакетов (50→25), чтобы регрессия светилась, а не была заглушена. Prod-отчёт:
  **3/19/27/3 (52) → 2/8/16/3 (29)**, видимый базлайн ужат до **0/0/1/2** (`tech-debt/pnpm-audit.txt` на ветке).
  Остаток — **2 critical, оба в `next`**: закрываются только мажором Next 14→15 (async params + каскад
  react 19 / zustand 5 / recharts 3 + регресс 36 страниц web и 20 admin — отдельная задача). Временно
  выключена поверхность атаки: `apps/web/next.config.js:31` — `formats: ['image/webp']`, AVIF убран
  (GHSA-2xp9-vwfh-vxw4 — RCE в Next Image Optimization через декодирование AVIF); на `origin/main` строка 28
  всё ещё `['image/avif','image/webp']`, пока #140 не влит. **Почему `PARTIAL`, а не `ACCEPTED`:** позиция
  не «решение не делать», а отложенное с известным сроком; цифры 2/8/16/3 и «586 тестов api зелёные» —
  отчёт автора PR, в этом дереве `pnpm audit`/`pnpm test` не запускались (§3.4).

### TZ-01…TZ-11 — досье построки

- **TZ-01 ✅ CLOSED.** `GET /api/v1/geo/config` — `apps/api/src/modules/geo/presentation/controllers/geo.controller.ts:14`,
  профили и методы — `packages/shared-config/src/geo.config.ts`.
- **TZ-02 ⏳ HUMAN (P2, без ответа с 2026-08-23).** Требование: MVP-валюты RUB + USDT_TRC20 + BTC, TON/TRX/LTC убраны из
  релиза. Проверялось дважды «убран публичный exchange-rates — проверить NOWPayments client», и два месяца ответа не было.
  Сверка 2026-10-02: `packages/shared-config/src/geo.config.ts:3` — `CryptoCurrency = 'USDT_TRC20' | 'BTC'` (релиз
  держится), а `apps/api/src/modules/payments/infrastructure/clients/nowpayments.client.ts:15-21` маппит `TON`, `TRX`,
  `LTC` (строки MAP: `ton`, `trx`, `ltc`), то есть клиент способен завести платёж в валюте, исключённой из релиза; путь
  туда из UI отсечён (WithdrawSheet и DepositSheet показывают только методы GeoConfig — см. досье GAP-55 п. з), но
  поверхность остаётся. **Решение за владельцем:** удалить 3 позиции маппинга (и связанные ветки в
  `nowpayments-ipn.spec.ts`) или признать их заделом фазы 2 и зафиксировать в ТЗ ч.3 и `PAYMENT_OVERVIEW.md`. Агент не
  выбирает: любое из двух меняет контракт с провайдером.
- **TZ-03 ✅ CLOSED.** `last_payment_method` — `packages/database/prisma/schema.prisma:130`, в baseline-миграции GAP-31;
  `DepositProfileService` обновляет поле. Замечание: порядок методов в кассе (`sortByLastMethod`) проверен только чтением
  DOM на стенде (`docs/UI_WAVE_5.1.md` §5, 2026-09-30), автотеста на него нет — UI-хвост ведён в GAP-46.
- **TZ-04 ✅ CLOSED.** `limit_remaining` + `?currency=` — `apps/api/src/modules/kyc/presentation/controllers/kyc.controller.ts:55-66`,
  спек `apps/api/test/kyc-status.spec.ts`.
- **TZ-05 ✅ CLOSED (было ⚠️ «webhook уже uses actually_paid»).** Зачисление факта, не exact amount:
  `apps/api/src/modules/payments/application/use-cases/process-nowpayments-webhook.use-case.ts:100-105`
  (`actually_paid` → `pay_amount` → fallback `pr.amount`) и `:109` (идемпотентность по внешнему id, GAP-28); закрыто
  тестом `apps/api/test/nowpayments-ipn.spec.ts` (4 обращения к `actually_paid` из 13 кейсов).
- **TZ-06 ✅ CLOSED.** `CURRENCY_NOT_SUPPORTED` и кросс-валютный запрет —
  `apps/api/src/modules/casino/application/use-cases/launch-game.use-case.ts`, спек `casino-launch-game.spec.ts`;
  на фронте — `LaunchCurrencySheet` и экран ошибки (GAP-55 п. в).
- **TZ-07 ✅ CLOSED.** Фронтенд web по ТЗ ч.5 — см. GAP-52…GAP-55 (код + спеки; браузерная приёмка — остаток GAP-46).
- **TZ-08 ⚖️ ACCEPTED (P3).** Phase 2 фиат UAH/BYN/KZT/UZS: форматирование, switcher и пресеты готовы, включение живёт за
  `fiatLive` (`packages/shared-config/src/geo.config.ts:22`, `false` во всех профилях кроме RU) и ключами PSP. Кодить
  нечего до договора с PSP — это позиция «решение не делать сейчас», а не незакрытый пункт.
- **TZ-09 🟦 CODE_DONE (P1).** Приёмка «первые 90 секунд»: гео-пресеты, депозит с `currency` + `method` — бэкенд и фронт
  реализованы (`docs/USER_FLOW_FIRST_90_SECONDS.md`, `apps/web/src/components/wallet/DepositSheet.tsx`), покрыты
  `deposit-sheet.spec.tsx`; прогона флоу на публичном HTTPS-домене не было → GAP-46 п.9. Прежняя формулировка
  «web flow частично» не уточняла, что именно частично — теперь остаток назван.
- **TZ-10 ✅ CLOSED (с продуктовой оговоркой).** Регистрация выдаёт сессию сразу: gate `emailVerified` в LoginUseCase снят,
  RegisterUseCase переписан (сессия + access-token немедленно), письмо-верификация идёт по очереди как информационное.
  **Оговорка, зафиксированная с 2026-08-24 и не снятая:** это продуктовое решение агента. Если для рынка СНГ верификация
  обязательна ДО игры — вернуть gate и выдавать сессию после verify-email. Связано с GAP-49 (возрастной гейт 18+ сейчас
  клиентский, серверной проверки `date_of_birth` при регистрации нет).
- **TZ-11 🟡 PARTIAL (P3, новая позиция).** ТЗ ч.8 §12.1 описывает маршрут детальной статистики `/affiliate/stats`; в
  коде — `apps/web/src/app/affiliate/(cabinet)/dashboard/page.tsx` (вкладки: dashboard, commissions, players, links,
  settings). Содержательные блоки §12.2 (баланс, ставка, клики, игроки, NGR с разбивкой, начисления, ссылка + выход из
  программы) на месте, прозрачность расчёта по §3.9 соблюдена (формула выведена на экране). Расхождение — имя маршрута:
  либо правка ТЗ, либо алиас/переименование. Мелочь, но в реестре должна быть, иначе «всё ч.8 покрыто» снова станет
  ложью.

## 7. История ревизий файла (что и когда менялось в самом документе)

| Дата          | Что                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-23    | Аудит ТЗ ↔ код: GAP-01…GAP-17, разделы «CRITICAL/HIGH/MEDIUM», TZ SYNC TZ-01…TZ-10                                                                                                                                                                                                                                                                                                |
| 2026-08-24    | Ревизия: закрыты GAP-03…GAP-12; слит параллельный WIP второго агента (geo-модуль, deposit-profile, web-компоненты — `d7a923d`, в main `8473f59a`); продуктовое решение TZ-10 (регистрация сразу выдаёт сессию)                                                                                                                                                                    |
| 2026-08-28    | Ревизия аудита 2026-08-25: перенос открытых пунктов аудита (17 из 30 исправлены) как GAP-18…GAP-30; снимок — `docs/archive/audit-2026-08-25.md`                                                                                                                                                                                                                                   |
| 2026-08-30/31 | Закрыты GAP-18…GAP-24, GAP-27 (ветка `security/gap-19-20-27`), P0 #3 (атомарность денег) и #4 (канонический sorted-JSON HMAC для IPN)                                                                                                                                                                                                                                             |
| 2026-09-01    | Закрыты GAP-25, GAP-26, GAP-28; CI-инфраструктура приведена в порядок (PR #20/#21/#23/#24: контекст docker-build = `casino-platform`, `@types/node`/`.npmrc` в образе, commitlint по squash-коммиту, `.gitleaks.toml` с allowlist плейсхолдеров, deploy-job пропускается без VPS-секретов)                                                                                        |
| 2026-09-01    | Аудит готовности → GAP-31…GAP-38 + обязательный формат «Критерий приёмки»                                                                                                                                                                                                                                                                                                         |
| 2026-09-02    | GAP-30…GAP-38 закрыты; аудит готовности #2 (GAP-39…GAP-51) с выводом «код MVP ~85%, приёмка 0%»                                                                                                                                                                                                                                                                                   |
| 2026-09-03    | GAP-39 (PR #36–55), GAP-40, GAP-41, GAP-42, GAP-43, GAP-45, GAP-47 (код), GAP-49 (инженерная часть)                                                                                                                                                                                                                                                                               |
| 2026-09-04    | GAP-48, GAP-50 (решение владельца), GAP-51 (ADR); находка про метки `TODO(GAP-22)`                                                                                                                                                                                                                                                                                                |
| 2026-09-09    | GAP-44 закрыт полностью; первый живой контур NOWPayments/Telegram (записан в GAP-46)                                                                                                                                                                                                                                                                                              |
| 2026-09-13/16 | GAP-52…GAP-55 (PR #80, #83–88)                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-27    | GAP-56 (9 дефектов, `fix/gap56-infra-drift`), GAP-47 прогон + GAP-57 (часть), GAP-58 (аудит контрактов)                                                                                                                                                                                                                                                                           |
| 2026-09-30    | GAP-57 закрыт (ADR advisory-лок + прогон)                                                                                                                                                                                                                                                                                                                                         |
| 2026-10-01    | GAP-59 (аудит проекта, PR #128), GAP-60 (п.3 «хрупкость и гигиена»)                                                                                                                                                                                                                                                                                                               |
| 2026-10-02    | Переход на единую схему реестра: GAP-46 выделен из строки GAP-45, GAP-56/58/59/60 получили ID, добавлены GAP-61…GAP-66 и TZ-11, пересчитаны счётчики (§4), переоткрыты GAP-16 и GAP-51, закрыты по факту GAP-13 и GAP-17                                                                                                                                                          |
| 2026-10-03    | **Сверка с волной #135…#141 (§1.1):** добавлены GAP-67…GAP-70, GAP-16 переведён `PARTIAL` → `CLOSED` (правка README в этой же ветке), GAP-62 уточнён тремя методами `UsersFacade` и оставлен `OPEN`, строки `Подтверждение` сверены заново на `origin/main` = `1abe706` (#138), счётчики §4 пересчитаны по ref-ам (api 85→94 spec-файлов, admin 3→4) с колонкой «на ветках ревью» |
| 2026-10-03    | **Юридические тексты (волна «Условия использования»):** `/legal/*` переведены с заглушек на черновики 1.0-черновик (`apps/web/src/content/legal`), `docs/LEGAL_COMPLIANCE.md` переписан (реестр плейсхолдеров, проектные числа, исследование регуляторов, матрица «можно/нельзя», таблица «текст ↔ код»), добавлены GAP-71 и GAP-72, GAP-49 пересобран в чек-лист D1…D11          |
| 2026-10-04    | **GAP-73 `OPEN` → `CLOSED`:** архив версий `docs/legal/versions/` + `registry.json` (sha256 снимка) и спека связки «архив ↔ рендер»; гейт повторного акцепта на входе (`reacceptRequired`, `POST /auth/terms/accept`, диалог); LEGAL_COMPLIANCE — R9 закрыт, добавлены §5.2 и §5.3; счётчики §2: `CLOSED` 58, `OPEN` 1                                                            |

## 8. Средовые заметки и процедурное (сохранено из прежней версии)

**Что было найдено в структуре проекта (2026-08-22, историческая таблица):**

| Проблема                                                                                                               | Статус                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/INDEX.md`: битые ссылки на `../tz-part-*.md`                                                                     | ✅ исправлено                                                                                                                                                                                                    |
| В корне не было машинно-читаемых инструкций агента (`AGENTS.md`, `.cursorrules`)                                       | ✅ созданы из §1/§2 `docs/AGENT_INSTRUCTIONS.md`                                                                                                                                                                 |
| Мусор вне git-репо (`/mnt/sdcard/Casino/apps`, `home`, `uploads` — старые копии доков)                                 | ⏳ не тронуто — решать владельцу                                                                                                                                                                                 |
| `.env` на диске, в git только `.env.example`                                                                           | ✅ ок                                                                                                                                                                                                            |
| Доки описывали схему как `prisma/schema/<area>.prisma` и `turbo.json`, а в реальности один `schema.prisma` и turbo нет | ✅ исправлено 2026-08-28 (AGENT_INSTRUCTIONS/MODULE_TEMPLATE/.cursorrules приведены к `schema.prisma`, упоминания turbo убраны, `events.ts` → `apps/api/src/queues/queue.types.ts`); возврат ловит docs-guard D5 |

**Environment — особенности машины, на которой начиналась разработка (Android SD-card / Termux).**
Исторически из-за них были приняты решения, которые сейчас нужно знать, чтобы «починить» обратно:
`/mnt/sdcard` = Android FUSE — symlinks запрещены, поэтому в `.npmrc` стоит `bin-links=false`; оффлайн-store без
registry не давал `jsonwebtoken` (JWT реализован на node:crypto) и `@types/multer` (шимы были удалены в #132, В10
в [TECH_DEBT.md](TECH_DEBT.md)); Prisma client в той среде не генерировался, часть проверок делалась через
hoisted-копию. На нормальной Linux-FS машине: `pnpm install && pnpm db:generate && pnpm db:migrate`.

**Как добавлять позицию в этот реестр.** 1) строка в §2 (все 8 колонок заполнены, `Подтверждение` — путь или PR); 2) при необходимости — досье в §6 с критерием приёмки и обоснованием; 3) статус `HUMAN` сопровождается списком того, чего
нет в репозитории, а не выдуманными значениями; 4) `docs-guard` (D1 ссылки, D2 пути из бэктиков) обязан быть зелёным —
локально `sh scripts/docs-guard-local.sh`; 5) `docs/INDEX.md` §6.3: реестр обновляется в том же PR, что код.
