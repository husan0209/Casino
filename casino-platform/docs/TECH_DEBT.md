# TECH_DEBT — реестр архитектурного долга под храповиком

> Статус: заведён 2026-09-27. Правила архитектуры включены в error, но
> СУЩЕСТВУЮЩИЙ долг заморожен в базлайнах — CI краснеет только если долг
> ВЫРОС, и предупреждает, когда часть долга погашена и базлайн можно ужать.
> Так новый код чист с первого дня, а старый гасится постепенно, без красного CI.

## Как работает храповик

- Детектор один: `scripts/bin/tech-debt` (gen — перезаписать базлайн, check — сверить).
- Базлайны лежат в `tech-debt/<name>.txt`, формат `путь<TAB>количество`
  (для use-case-specs — путь на строку). Базлайн правится ТОЛЬКО командой gen.
- Гuards CI: G16–G21 в `.github/workflows/architecture-guards.yml`
  (каждый — `sh scripts/bin/tech-debt check <name>`).
- **FAIL** — новый файл с нарушением или рост числа нарушений в файле.
- **WARN** — долг погашен: ужми базлайн (`sh scripts/bin/tech-debt gen <name>`)
  в том же PR, иначе храповик начнёт шуметь.

## Реестр (замер на 2026-09-27)

| Гард | Правило | Замер | Базлайн | Как гасить |
|------|---------|-------|---------|------------|
| G16 | Кросс-модульные deep-импорты мимо Facade | 29 в 24 файлах | `tech-debt/cross-module-imports.txt` | Импортировать только `*.facade` цели; для авторских guard'ов (`AuthGuard`, `RolesGuard`) решить: вынести в common или оформить как публичный API auth-модуля |
| G17 | Сырой `new Error()` вместо AppError-подклассов | 58 | `tech-debt/raw-error.txt` | Обернуть в доменный AppError (`code` + `httpStatus`); механическая работа, гасить по модулю |
| G18 | NestJS built-in exceptions (`BadRequestException` и др.) | 19 | `tech-debt/nest-exceptions.txt` | То же: AppError-подкласс вместо HttpException |
| G19 | `eslint-disable` в продакшн-коде | 25 (max-params 13, no-explicit-any 10, по одному exhaustive-deps и no-var-requires) | `tech-debt/eslint-disable.txt` | Каждое разобрать: чинить код либо переносить в overrides `.eslintrc.js` с обоснованием (QUALITY_GATES §2.1.1) |
| G20 | Денежное поле, типизированное `number` | 1 (`nowpayments.client.ts` — парсинг ответа провайдера) | `tech-debt/money-number.txt` | Конвертировать в string сразу при парсинге ответа |
| G21 | Use-case без теста (соседний `.spec.ts` ИЛИ имя класса в `apps/api/test/`) | 33 из 40 (замер 2026-09-28, после Волны 3а) | `tech-debt/use-case-specs.txt` | Писать тесты на новые use-cases сразу; старые — по мере рефакторинга. Каждый новый use-case без теста = FAIL |
| audit (ci.yml) | Уязвимости prod-зависимостей (pnpm audit) | 3 critical · 22 high · 27 moderate · 3 low | `tech-debt/pnpm-audit.txt` | Dependabot/`pnpm up` по конкретным advisory; после мержа фикса — `node scripts/audit-ratchet.mjs --gen`. Конкретный список — в логах job'а `audit` (локально на Windows отчёт урезан EMFILE) или в GitHub Dependabot alerts |

Замечание к audit-храповику: реестр CVE живёт своей жизнью — если в
транзитивной зависимости появится новый advisory, job покраснеет БЕЗ твоих
изменений. Это осознанно (новый CVE обязан попасть в триаж), а не регресс
храповика: триаж — upgrade / `pnpm.auditOverrides` в package.json / mute,
затем `--gen`.

Замечания к правилам (осознанные ограничения детекторов):

- G20 не проверяет `total`: в пагинации это счётчик записей, не деньги
  (изначальный «замер на 38» почти весь состоял из таких ложных срабатываний).
- G16 разрешает импорт `*.facade` — это публичный API модуля. Фасады живут в
  трёх разных местах (`<mod>/application/<mod>.facade.ts`, `<mod>/facade/`);
  унификация — отдельная задача, сейчас это не нарушение.
- G16 не считает модулями `queues/`, `common/` и прочее вне `src/modules/`.

## Внутренние гэпы соответствия инструкциям

Замер 2026-09-27: насколько код соответствует собственным правилам репо
(MODULE_TEMPLATE, MODULE_BOUNDARIES, AI_DEVELOPMENT_RULES, ARCHITECTURE) и
принятым пунктам пакетов аудита. Это не гейты — это план работ до состояния
«код ≡ инструкции». Пункты 1–2 блокируют canary-тесты структуры (блок H
пакета аудита): сначала нормализация, потом гард.

| # | Гэп | Правило (источник) | Замер | Что делать | Проверка после |
|---|-----|--------------------|-------|------------|----------------|
| В1 | **7 модулей без Facade**: admin, auth, casino, maintenance, notifications, referrals, support (~~kyc, payments~~ — созданы 2026-09-28, Волна 3а) | MODULE_TEMPLATE Шаг 8: `facade/<module-name>.facade.ts` обязателен; MODULE_BOUNDARIES: «ONE Facade per module» | Фасады: geo, users, kyc, payments; wallet — не по шаблону (`application/wallet.facade.ts`) | Создать фасады по шаблону (порядок: wallet, casino, admin — кого дёргают чужие); wallet переехать в `facade/`; maintenance — cron-модуль, фасад не требуется (решение В1-обсуждения) | Canary «ровно один фасад по шаблону»; ужать G16 |
| В2 ✅ | **Тонкие модули вне шаблона**: health (только presentation), maintenance (без presentation) — **ЗАКРЫТО 2026-09-28, PR #99** (решение владельца: достроить) | MODULE_TEMPLATE: 4 слоя у каждого модуля | 2 модуля из 13 | health: domain-порт проб → application get-readiness (+spec) → infrastructure-пробы → тонкий контроллер; maintenance: presentation с admin-триггером run-daily (переехал из referrals) | ✅ Canary структуры модулей |
| В3 | **Presentation вызывает инфраструктуру/репозитории напрямую** (runtime): `AdminAuthService` ×2, `ProviderAdapterFactory` ×2, `PaymentRequestRepository` ×2, `JwtTokenService` ×1; kyc/support контроллеры инжектят `IKycRepository`/`ISupportRepository` с DI-токенами ×4 | AI_DEVELOPMENT_RULES §3: HTTP только в presentation, бизнес-логика только в application/use-cases; «controllers ничего не знают о business logic» (§12) | ~8 runtime-мест + 4 контроллера с репозиториями | Прогнать через application-сервисы/use-cases; контроллер — только вызов use-case + ответ | Новый grep-гард «presentation без infrastructure/runtime-repo» после обнуления |
| В4 | **Type-only импорты domain-типов в presentation** (row-типы как формы ответа): AdminUserRow, CreditResult, ProviderGameRow, ParsedProviderCallback, GeoConfigResult, KycProfileRow, MessageRow, TicketCategory, UserProfileFull | MODULE_TEMPLATE: presentation → application (DTOs only) | 9 мест | Перенести типы в `@casino/shared-types` или DTO-мапперы application-слоя; либо узаконить «read-типы можно» отдельной правкой шаблона | Тот же будущий гард, warn-уровень |
| В5 ✅ | **application → infrastructure напрямую, мимо интерфейсов** — **ЗАКРЫТО 2026-09-28, PR #99** (решение владельца: интерфейсизировать): payments (IPaymentRequestRepository/IRukassaClient/INowPaymentsClient), auth (IPasswordHasher/IJwtTokenService/IEmailQueueService/ICaptchaService), casino (IProviderAdapterFactory) — порты + Symbol-токены, `useExisting`-проводка | MODULE_TEMPLATE: `application → infrastructure (THROUGH interfaces only)` | Было 23+1 cross-module | Остаток: presentation payments не переключен (мелочь), `common/guards/optional-auth.guard` типизируется классом JwtTokenService (вне modules/, легальный DI-поток через экспорт AuthModule) — В1-территория | Замер `grep from .*infrastructure modules/*/application` = 0 |
| В6 ✅ | **Cross-module deep-импорты (G16-базлайн) — ЗАКРЫТО 2026-09-28, PR #99** (решение владельца: guards auth = публичный API) | MODULE_BOUNDARIES §15 (Dependency Graph), «только через Facade» | Было 29 в 24 файлах | G16 исключает `*.guard` (рядом с `*.facade`); остаток 13 файлов — план: фасады В1, `NOWPaymentsClient` в maintenance → фасад/перенос | G16 → 0, базлайн удалён |
| В7 | **MODULE_BOUNDARIES не соответствует коду**: нет секции maintenance; секции Game-Sessions (§8) и Audit (§12) не существуют как модули в `apps/api/src/modules/` | docs/INDEX.md §6.2: приоритет кода; AGENTS.md: сверяйся с MODULE_BOUNDARIES | 1 отсутствующая + 2 лишних секции | Дописать секцию maintenance (cron-модуль, порты, BullMQ-repeatable); сверить Game-Sessions/Audit с фактическим размещением (casino/admin?) и поправить карту | docs-guard D10-стиль проверка вручную; можно добавить гард «каждый модуль из ls описан в доке» |
| В8 | **Canary-тесты архитектуры** (4 слоя, ровно 1 фасад, чистота domain) из пакета аудита | Пакет аудита, блок H | Заблокировано В1–В2 | Ввести после В1/В2 как vitest-спеку; AST-проверки импортов не нужны — их закрывают G1/G16 и depcruise, если решим взять | Новый spec в `apps/api/test/` |
| В9 | **Pre-commit hook неп usable для части файлов**: lint-staged гоняет eslint из корня монорепо — `@/*`-алиасы api не резолвятся (`import/no-unresolved`), а `apps/api/test/**` даёт ~150 type-aware warning'ов (обычный `pnpm lint` их не видит — api-lint смотрит только `src/`) | Конвенция репо: hooks обязательны, `--no-verify` — исключение | Выявлено 2026-09-27 при пересборке коммитов | Настроить per-package контекст в lint-staged (запуск `pnpm --filter <pkg> exec eslint` или project-ссылки в import/resolver) и решить, линтится ли `apps/api/test/**` (включить в api-lint или исключить из lint-staged) | `git commit` с тестами в staged проходит без `--no-verify` |
| В10 | **Шимы типов multer вместо @types/multer**: `apps/api/src/types/multer.d.ts` (Express.Multer.File + аугментации Request) и `multer-ambient.d.ts`; колбэки StorageEngineOptions типизированы `unknown` | Комментарий шимов: «pnpm add -D @types/multer и удалить» | 2 шим-файла; diskStorage не используется (только memoryStorage) | Переезд нетривиален: в реальных типах `file.buffer` опционален (kyc/users используют `file.buffer` — нужны guards), а `@types/multer` тянет `@types/express`, с которым конфликтует аугментация `Express.Request.cookies` (GAP-39). План: поставить типы, оградить buffer, разрешить конфликт cookies (или вынести его в отдельный d.ts) | `pnpm add -D @types/multer` + typecheck зелёный без шимов |
| В11 | **`price_amount: Number(params.priceAmount)` в запросе createPayment к NOWPayments** — деньги уходят провайдеру числом (замечание агента при G20-fix) | AI_DEVELOPMENT_RULES §1 (деньги — string) | 1 место + number-арифметика в dev-stub курса | Сверить контракт NOWPayments: если JSON-схема провайдера требует число — узаконить с комментарием в коде и note в PAYMENT_OVERVIEW; если принимает строку — слать string | Контракт сверен, решение задокументировано |

Осознанные отклонения от пакетов аудита (НЕ долг, решения приняты):

- `.cursor/rules/*.mdc` не вводим — единая точка правды `AGENTS.md` (производный
  от `AGENT_INSTRUCTIONS.md`, целостность ловит docs-guard D5); третья копия
  правил = новая поверхность дрейфа.
- `eslint-plugin-boundaries` не берём — те же проверки уже закрывают G1/G15/G16
  + ESLint-override; пересмотреть, если G16 станет узким местом.
- `dependency-cruiser` — кандидат на В8-этап: реальный граф зависимостей
  (ловит относительные импорты точнее grep) + проверка циклов + SVG-граф.
- Бейдж Architecture Health Score (Gist-секреты ради метрики, формула которой
  сейчас даёт 0/100) — отклонён.

## Приоритет погашения

Дорожная карта «код ≡ инструкции» (В-гэпы) + храповик (G-гарды), по фазам:

**Фаза 1 — быстрые победы (дни):**
1. G20 — единственное money-`number` в парсере провайдера.
2. В7 — привести MODULE_BOUNDARIES к коду (секция maintenance, сверка Game-Sessions/Audit) — дешёво, а В1/В6 без этого делать нельзя.
3. G19 — легализовать max-params в overrides с обоснованием (QUALITY_GATES §2.1.1), починить no-explicit-any.

**Фаза 2 — архитектурные решения (одна встреча, правки шаблона):**
4. В2 — узаконить «тонкие модули» (health/maintenance) в MODULE_TEMPLATE или решить достраивать.
5. В5 — выбрать: интерфейсизировать application→infrastructure или узаконить class-токены.
6. В6.1 — объявить guards auth публичным API и исключить их из G16.

**Фаза 3 — нормализация (недели, по модулям):**
7. В1 — фасады для 9 модулей (порядок: kyc, payments, wallet, casino → кто их потребляет).
8. В3/В4 — presentation через use-cases, типы ответов в shared-types/DTO.
9. G17/G18 — 77 сырых ошибок: механический burn-down по модулям, параллельно с В1 (один PR = один модуль: фасад + ошибки + спеки).

**Фаза 4 — чистовик:**
10. G16 → 0 и удаление базлайна; G21 — тесты на все use-cases; В8 — canary-тесты структуры; dependency-cruiser как опция.

Каждое ужатие базлайна — в том же PR, где погашен долг («История ужатия» ниже).

## История ужатия базлайна

| Дата | Гард | Было → Стало | PR |
|------|------|--------------|-----|
| 2026-09-27 | все | базлайны заведены (58/19/25/1/40/29) | #97 |
| 2026-09-28 | G20 | money-number: 1 → 0 | Волна 1 |
| 2026-09-28 | G19 | eslint-disable: 25 → 13 (остались только max-params DI-конструкторов) | Волна 1 |
| 2026-09-28 | В6 | cross-module: 24 → 13 файлов (guards auth легализованы) | PR #99 |
| 2026-09-28 | В2/В5 | слои health/maintenance достроены; application→infrastructure = 0 (порты+токены) | PR #99 |
| 2026-09-28 | Волна 3а | raw-error 58→46, nest-exceptions 19→13, cross-module 13→8 файлов, G21 40→33 (kyc+payments: фасады, В3/В4, ошибки→AppError, 3 спека) | PR #100 |
