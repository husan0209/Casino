# Affiliate Module — партнёрская программа

> ТЗ: `docs/tz-part-8-affiliate-program.md`. Границы: `docs/MODULE_BOUNDARIES.md` §9a.

## Ответственность

Партнёрская программа для **внешних вебмастеров**: регистрация партнёра,
трекинг-ссылка `/go/{code}`, привязка игроков, расчёт RevShare от NGR,
начисление на кошелёк партнёра, clawback, антифрод, admin-API.

## НЕ путать с referrals

`referrals` — программа «приведи друга» для игроков (GGR, ставка из env).
`affiliate` — внешние партнёры, индивидуальная ставка, расчёт от **NGR**,
отдельный кабинет. Общее у них только `game_transactions` (источник сумм) и
`ledger_entries` (приём начислений).

## Ключевые use cases

| UC              | Название                                          |
| --------------- | ------------------------------------------------- |
| UC-AFF-01       | Регистрация партнёра                              |
| UC-AFF-02       | Вход партнёра                                     |
| UC-AFF-05       | Трекинг клика (публичный `/go/:code`)             |
| UC-AFF-06       | Атрибуция игрока при регистрации                  |
| UC-AFF-07       | Квалификация атрибуции (депозит + KYC)            |
| UC-AFF-08       | Расчёт NGR за период                              |
| UC-AFF-09       | Создание начисления (дедуп)                       |
| UC-AFF-10       | Начисление на кошелёк партнёра                    |
| UC-AFF-11       | Суточный прогон (оркестрация 08–10)               |
| UC-AFF-12/13/14 | Дашборд / начисления / игроки в кабинете          |
| UC-AFF-16       | Выход из программы (self-service)                 |
| UC-AFF-17–25    | Admin: партнёры, ставки, настройки, ручной прогон |
| UC-AFF-26       | Clawback при самоисключении игрока                |

## Зависит от

- `wallet` — `WalletFacade.credit/debit` (единственный способ тронуть деньги)
- `admin` — `AuditLogService` (аудит смены ставки/статуса/настроек)
- `auth` — `RolesGuard` на admin-эндпоинтах
- `users` — порт `RESPONSIBLE_GAMING_HOOK` (реализацию clawback поставляем мы)
- read-only: `game_transactions`, `ledger_entries`, `kyc_profiles`, `users`
  (кошельки/проводки читаются как компонент NGR-агрегата — см.
  `sumPlayerBonuses`; деньги начисляются ТОЛЬКО через `WalletFacade`)
- ⚠️ **GAP-62, не read-only**: `users` ещё и **пишется** — провижининг
  служебной user-записи партнёра (`createPlayerUser`/`deletePlayerUser` в
  `infrastructure/player-provisioning.prisma.repository.ts`). ADR GAP-51
  разрешает только чтение, так что это нарушение границ, а не реализованная
  часть ADR. Убрать нельзя, пока `UsersFacade` не отдаст
  `provisionAffiliatePlayer(input)` и `deprovisionAffiliatePlayer(userId)` —
  запрос зафиксирован в шапке репозитория.

## Используется в

- `auth` — привязка игрока при регистрации (через `ModuleRef`, см. ниже)
- `maintenance` — `affiliate-daily`, `affiliate-qualification`,
  `affiliate-clicks-cleanup`

## Экспортирует

`AffiliateFacade` (+ `AffiliateJwtService`, `AffiliateAuthGuard` для своих
контроллеров). Остальные use cases — внутренние.

## Ловушки при доработке

1. **Не импортировать affiliate из auth напрямую.** `affiliate.module` уже
   импортирует `AuthModule` (нужен `RolesGuard`) — прямой импорт создаст цикл
   модулей, запрещённый `MODULE_BOUNDARIES` §16.4. Привязка вызывается из
   `RegisterUseCase` через `ModuleRef.get(AffiliateFacade, { strict: false })`.
2. **`IpHasher` должен быть один экземпляр.** В DI это `useExisting`, не
   `useClass`. Два инстанса дадут разные хеши для одного IP, и антифрод F1/F3
   молча перестанет срабатывать.
3. **Ставка не применяется задним числом.** Начисление хранит снимок
   `revshare_rate`. Смена ставки — со следующего периода. Откатывать
   зачисленные деньги нельзя.
4. **`provider_fee_sum` всегда 0 в MVP** — комиссии game-провайдеров в системе
   не рассчитываются (см. `PROVIDER_FEE_NOTE`). Это осознанное упрощение, а не
   баг; при появлении данных вычет подключается без изменения схемы.
5. **IP в открытом виде не хранится** — только SHA-256(ip + `INTERNAL_API_SECRET`).
6. **Clawback может стать невозвратным**, если партнёр уже вывел заработок:
   такие суммы собираются в `insufficientFunds` и логируются как ERROR. Это
   операционная задолженность, её разбирают вручную.
7. **`affiliate.click_retention_days` >= `affiliate.cookie_days`**, иначе к моменту
   регистрации свежих кликов не останется и self-referral не обнаружится.
8. **`@Inject` обязателен на КАЖДЫЙ параметр конструктора.** В этой сборке
   (TypeScript 6 / tsgo) `emitDecoratorMetadata` не выдаёт
   `design:paramtypes`, поэтому инъекция «по типу» молча передаёт
   `undefined`. Проверено функциональным прогоном: `AffiliateSettingsService`
   приходила `undefined` во все use-case'ы, где токен был class'ом без
   `@Inject`; Symbol-токены работали, потому что `@Inject` писался всегда.
   Симптом в проде — `Cannot read properties of undefined` на первом же
   обращении к зависимости. Ни `tsc`, ни `eslint`, ни юнит-тесты это не
   видят: тип резолвится, значение в рантайме отсутствует. Проверка:
   `pnpm --filter @casino/api check:di-inject`.
