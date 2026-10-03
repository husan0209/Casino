# Branch Protection Setup

> **Статус: ✅ настроено 2026-08-28** (GitHub Ruleset, покрывает `main` + `dev`, bypass list пуст, PR + 1 approval, 4 статус-чека, linear history, force push/удаление запрещены). Осталось вручную: секреты `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` для deploy.
> CODEOWNERS отложен до появления второго ревьюера — тогда создать файл по заготовке (см. ниже) и одновременно включить «Require review from Code Owners» в ruleset.

> **REQUIRED for production.** Workflow files in `.github/workflows/` cannot declare
> branch protection rules — they must be configured manually in the GitHub UI.
> Until you do this, the `quality` job in `ci.yml` can pass OR fail, and any
> developer (or compromised token) can still `git push origin main` directly.

## Steps

1. Open **Settings → Branches → Branch protection rules → Add rule**
2. **Branch name pattern:** `main`
3. Enable:
   - [x] **Require a pull request before merging**
   - [x] **Require approvals:** `1` (or `2` for `apps/api/src/modules/{payments,wallet,auth}/`)
   - [x] **Require status checks to pass before merging**
     - Search and add: `secrets-scan` (gitleaks, job в корневом `.github/workflows/ci.yml`)
     - Search and add: `commitlint` (job в корневом `.github/workflows/ci.yml`)
     - Search and add: `audit` (pnpm audit, job в корневом `.github/workflows/ci.yml`)
     - Search and add: `lint-typecheck-test` (job в корневом `.github/workflows/ci.yml`)
     - Search and add: `docker-build` (job в корневом `.github/workflows/ci.yml`, только main)
     - Search and add: `Architecture guards` (job `guards` в корневом `.github/workflows/architecture-guards.yml`)
     - Search and add: `docs-guard` (job в корневом `.github/workflows/docs-guard.yml`)

   ⚠️ Workflows живут в КОРНЕ репо (`.github/workflows/`), а не в `casino-platform/.github/` — GitHub Actions читает только корневой каталог. Все run-шаги через `defaults.working-directory: casino-platform`.

   Правило имён required check: чек-ран = значение `name:` job'а, а если оно не задано — job id. В списке выше 6 job'ов намеренно БЕЗ `name:` (чек = job id) и один с ним (`Architecture guards`). Если добавишь job с `name:` — добавляй в список display-name, иначе ruleset вечно будет ждать «Expected». Нарушение ловит docs-guard D6.
   - [x] **Do not allow bypassing the above settings**
   - [x] **Require linear history** (no merge commits)

4. Repeat for `dev` branch if used.

## Required secrets (Settings → Secrets and variables → Actions)

| Secret        | Used by                                            | How to generate                            |
| ------------- | -------------------------------------------------- | ------------------------------------------ |
| `VPS_HOST`    | job `deploy` в корневом `.github/workflows/ci.yml` | Your VPS IP or hostname                    |
| `VPS_USER`    | job `deploy` в корневом `.github/workflows/ci.yml` | SSH user (e.g. `deploy`)                   |
| `VPS_SSH_KEY` | job `deploy` в корневом `.github/workflows/ci.yml` | `ssh-keygen -t ed25519`, paste private key |

## CODEOWNERS (recommended)

Create `.github/CODEOWNERS`:

```
# Default: tech lead approves everything
* @husan0209

# Critical paths require extra review
/casino-platform/apps/api/src/modules/payments/   @husan0209
/casino-platform/apps/api/src/modules/wallet/     @husan0209
/casino-platform/apps/api/src/modules/auth/       @husan0209
/casino-platform/infra/                           @husan0209
/casino-platform/packages/database/prisma/        @husan0209
```

## Verify

After setup, try to merge a PR with a failing `Architecture guards` check — it should be blocked.

## Что чистится после мержа (вторая половина защиты)

Ruleset выше запрещает плохому коду попасть в `main`, но не мешает репозиторию зарасти мусором.
Ветка, оставленная после мержа, — это не «архив», а активный ref: она участвует в
`git for-each-ref`, в автодополнении, в `git log --all` и в индексации каждым следующим деревом,
а файлы, которых больше нигде нет, в любой момент могут уехать в чужой мерж. Состояние на
2026-10-02: 55 веток в `refs/heads` (31 из них уже не существуют в remote), 15 якорей
`refs/saved/*` и 12 задублированных в remote записей `refs/saved/*`.

Разделение ответственности:

| Что                              | Где      | Кто делает                                                                                  |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| head-ветка PR                    | remote   | агент, замерживший PR, сразу после мержа: `git push origin --delete <ветка>` (или Delegate) |
| та же ветка                      | локально | тот же агент в тот же заход: `git branch -D <ветка>`                                        |
| устаревшие remote-tracking       | локально | любой: `git fetch origin --prune`                                                           |
| `refs/saved/*`, `refs/archive/*` | локально | разбор реестра по возрасту, три исхода на каждый якорь — CONVENTIONS §10.5                  |
| ветки с уникальным содержимым    | —        | НЕ удаляются: сначала спасение (коммит/PR), потом удаление — CONVENTIONS §10.5              |

Правила, которые здесь же и проверяются:

- **Удаление — часть DoD агента, а не «генеральная уборка потом».** Агент, сделавший мерж, не
  закрывает задачу, пока не удалил свою ветку в remote и локально.
- **Основание для удаления — только содержательная проверка**, а не `git branch --contains` и не
  `git cherry`: squash-мерж меняет sha, и влитая ветка для них неотличима от брошенной. Метод
  (`merge-tree --write-tree` + тест добавленных файлов с проверкой по истории blob'ов) и полный
  разбор 55 веток — CONVENTIONS §10.5.
- **Защита от регресса при мерже отстающей ветки**: ruleset ловит не пройденные чеки, но не ловит
  откат содержимого — #121 (`2568766`) squash-мержем поднял `tech-debt/use-case-specs.txt` с 28
  записей до 33, и храповик `tech-debt check` это пропустил, потому что был испорчен сам базлайн.
  Guard «`tech-debt/*.txt` не растут после мержа» — CONVENTIONS §10.5.
- **Якоря `refs/saved/*` в remote не пушим** — это локальные снимки WIP; их содержимое либо
  становится коммитом, либо переносится в `refs/archive/*`, либо удаляется осознанно.

## Related

- `docs/archive/audit-2026-08-25.md` §6 — analysis of protection gaps
- `docs/QUALITY_GATES.md` §3.5 — note on not modifying `ci.yml`
- `.github/workflows/architecture-guards.yml` — what `Architecture guards` job enforces
- `docs/CONVENTIONS.md` §10.5 — жизненный цикл ветки: критерий удаляемости, метод проверки
  «уже в main», запрет мусорных префиксов и реестр `refs/saved/*`
