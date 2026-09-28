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
| G21 | Use-case без соседнего `.spec.ts` | 40 из 40 | `tech-debt/use-case-specs.txt` | Писать тесты на новые use-cases сразу; старые — по мере рефакторинга. Каждый новый use-case без теста = FAIL |
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
| В1 | **9 модулей без Facade**: admin, auth, casino, kyc, maintenance, notifications, payments, referrals, support | MODULE_TEMPLATE Шаг 8: `facade/<module-name>.facade.ts` обязателен; MODULE_BOUNDARIES: «ONE Facade per module» | Фасады есть только у geo, users; wallet — не по шаблону (`application/wallet.facade.ts`) | Создать фасады по шаблону, начиная с модулей, которых дёргают чужие (kyc, payments, wallet, admin); для maintenance решить, нужен ли (cron-модуль без внешних потребителей); wallet переехать в `facade/` | Canary «ровно один фасад по шаблону»; ужать G16 |
| В2 | **Тонкие модули вне шаблона**: health (только presentation), maintenance (без presentation) | MODULE_TEMPLATE: 4 слоя у каждого модуля | 2 модуля из 13 | Либо узаконить «тонкие модули» отдельным разделом шаблона (infra-probe, cron), либо достроить слои. Решение — за архитектором | Canary структуры модулей |
| В3 | **Presentation вызывает инфраструктуру/репозитории напрямую** (runtime): `AdminAuthService` ×2, `ProviderAdapterFactory` ×2, `PaymentRequestRepository` ×2, `JwtTokenService` ×1; kyc/support контроллеры инжектят `IKycRepository`/`ISupportRepository` с DI-токенами ×4 | AI_DEVELOPMENT_RULES §3: HTTP только в presentation, бизнес-логика только в application/use-cases; «controllers ничего не знают о business logic» (§12) | ~8 runtime-мест + 4 контроллера с репозиториями | Прогнать через application-сервисы/use-cases; контроллер — только вызов use-case + ответ | Новый grep-гард «presentation без infrastructure/runtime-repo» после обнуления |
| В4 | **Type-only импорты domain-типов в presentation** (row-типы как формы ответа): AdminUserRow, CreditResult, ProviderGameRow, ParsedProviderCallback, GeoConfigResult, KycProfileRow, MessageRow, TicketCategory, UserProfileFull | MODULE_TEMPLATE: presentation → application (DTOs only) | 9 мест | Перенести типы в `@casino/shared-types` или DTO-мапперы application-слоя; либо узаконить «read-типы можно» отдельной правкой шаблона | Тот же будущий гард, warn-уровень |
| В5 | **application → infrastructure напрямую, мимо интерфейсов**: payment-request.repository ×6, password-hasher ×4, jwt.service ×4, email-queue ×2, rukassa/nowpayments ×4, captcha, provider-adapter.factory; из них 1 cross-module (`auth/infrastructure/jwt.service` из чужого application) | MODULE_TEMPLATE: `application → infrastructure (THROUGH interfaces only)` | 23 импорта (19 файлов) | Не механика, а решение: интерфейсизировать DI-токены (правильно, но дорого) или узаконить class-токены правкой шаблона с обоснованием (дешевле). Cross-module случай закрыть фасадом auth в любом случае | Решение фиксируется в MODULE_TEMPLATE; повторный замер |
| В6 | **Cross-module deep-импорты (G16-базлайн, 29 шт.) — план по парам**: auth ← 8 модулей (14 импортов, в основном `AuthGuard`/`RolesGuard`, которые MODULE_BOUNDARIES §2.5 объявляет публичным API) · payments ← kyc ×3 · wallet ← casino ×2, admin ×1 · payments ← maintenance ×2, admin ×2, casino ×1 · admin ← referrals ×1, kyc ×1 · maintenance ← referrals ×1 · geo ← users ×1 | MODULE_BOUNDARIES §15 (Dependency Graph), «только через Facade» | 29 в 24 файлах | 1) Узаконить guards auth как публичный API и научить G16 исключать `auth/presentation/guards/`; 2) заменить внутренние импорты на фасады из В1; 3) `maintenance → NOWPaymentsClient` — вынести клиента в shared-слой или дёргать через фасад payments | G16 → 0, базлайн удалён |
| В7 | **MODULE_BOUNDARIES не соответствует коду**: нет секции maintenance; секции Game-Sessions (§8) и Audit (§12) не существуют как модули в `apps/api/src/modules/` | docs/INDEX.md §6.2: приоритет кода; AGENTS.md: сверяйся с MODULE_BOUNDARIES | 1 отсутствующая + 2 лишних секции | Дописать секцию maintenance (cron-модуль, порты, BullMQ-repeatable); сверить Game-Sessions/Audit с фактическим размещением (casino/admin?) и поправить карту | docs-guard D10-стиль проверка вручную; можно добавить гард «каждый модуль из ls описан в доке» |
| В8 | **Canary-тесты архитектуры** (4 слоя, ровно 1 фасад, чистота domain) из пакета аудита | Пакет аудита, блок H | Заблокировано В1–В2 | Ввести после В1/В2 как vitest-спеку; AST-проверки импортов не нужны — их закрывают G1/G16 и depcruise, если решим взять | Новый spec в `apps/api/test/` |
| В9 | **Pre-commit hook неп usable для части файлов**: lint-staged гоняет eslint из корня монорепо — `@/*`-алиасы api не резолвятся (`import/no-unresolved`), а `apps/api/test/**` даёт ~150 type-aware warning'ов (обычный `pnpm lint` их не видит — api-lint смотрит только `src/`) | Конвенция репо: hooks обязательны, `--no-verify` — исключение | Выявлено 2026-09-27 при пересборке коммитов | Настроить per-package контекст в lint-staged (запуск `pnpm --filter <pkg> exec eslint` или project-ссылки в import/resolver) и решить, линтится ли `apps/api/test/**` (включить в api-lint или исключить из lint-staged) | `git commit` с тестами в staged проходит без `--no-verify` |

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
| 2026-09-27 | все | базлайны заведены (58/19/25/1/40/29) | этот |
