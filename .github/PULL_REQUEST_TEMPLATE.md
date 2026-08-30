## Что делает

<!-- Краткое описание. Один PR — одна задача. -->

## Связанные задачи

Closes #NNN / GAP-NN

## Тип изменений

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Docs
- [ ] Refactor

## Документация (правило — INDEX.md §6.3)

- [ ] Менял `apps/api/src/modules/**` → обновил `docs/MODULE_BOUNDARIES.md` (§1 карта, §15 граф) и README модуля
- [ ] Менял env-переменные → синхронно обновил `docs/ENVIRONMENT_VARIABLES.md` и `.env.example` (guard D3 следит)
- [ ] Менял правило → изменил **у владельца** (INDEX §6.1), пересинхронизировал `docs/AGENT_INSTRUCTIONS.md` → `.cursorrules` / `AGENTS.md` (guard D5 следит)
- [ ] Менял money / idempotency / webhook логику → прогнал `docs/SECURITY_CHECKLIST.md` и `docs/QA_CHECKLIST.md`
- [ ] Статус «готово» отмечен только в `docs/IMPLEMENTATION_GAPS.md`, только если работает end-to-end

## Тестирование

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` — зелёные (в CI без `|| true`)
- [ ] Unit-тесты на новую логику (`*_use-case.spec.ts`)
- [ ] Manual E2E (если применимо)

## Чеклист

- [ ] Новые endpoints документированы (`docs/API_CONVENTIONS.md`)
- [ ] Деньги — только `string`/`decimal.js`, никаких `number`/`float`
- [ ] Idempotency key у всех финансовых операций
- [ ] Secrets только в `.env` / GitHub Secrets, в логи не попадают
- [ ] Чувствительных данных в коде/логах/PR нет
