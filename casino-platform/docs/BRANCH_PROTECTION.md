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
     - Search and add: `lint-typecheck-test` (job в корневом `.github/workflows/ci.yml`)
     - Search and add: `docker-build` (job в корневом `.github/workflows/ci.yml`, только main)
     - Search and add: `Architecture guards` (job `guards` в корневом `.github/workflows/architecture-guards.yml`)
     - Search and add: `docs-guard` (job в корневом `.github/workflows/docs-guard.yml`)

   ⚠️ Workflows живут в КОРНЕ репо (`.github/workflows/`), а не в `casino-platform/.github/` — GitHub Actions читает только корневой каталог. Все run-шаги через `defaults.working-directory: casino-platform`. Если добавишь новый job — добавь его сюда, иначе docs-guard D6 уронит CI.
   - [x] **Do not allow bypassing the above settings**
   - [x] **Require linear history** (no merge commits)
4. Repeat for `dev` branch if used.

## Required secrets (Settings → Secrets and variables → Actions)

| Secret | Used by | How to generate |
|--------|---------|-----------------|
| `VPS_HOST` | job `deploy` в корневом `.github/workflows/ci.yml` | Your VPS IP or hostname |
| `VPS_USER` | job `deploy` в корневом `.github/workflows/ci.yml` | SSH user (e.g. `deploy`) |
| `VPS_SSH_KEY` | job `deploy` в корневом `.github/workflows/ci.yml` | `ssh-keygen -t ed25519`, paste private key |

## CODEOWNERS (recommended)

Create `.github/CODEOWNERS`:

```
# Default: tech lead approves everything
* @husan0209

# Critical paths require extra review
/apps/api/src/modules/payments/ @husan0209
/apps/api/src/modules/wallet/   @husan0209
/apps/api/src/modules/auth/     @husan0209
/infra/                         @husan0209
/packages/database/prisma/      @husan0209
```

## Verify

After setup, try to merge a PR with a failing `Architecture guards` check — it should be blocked.

## Related

- `docs/archive/audit-2026-08-25.md` §6 — analysis of protection gaps
- `docs/QUALITY_GATES.md` §3.5 — note on not modifying `ci.yml`
- `.github/workflows/architecture-guards.yml` — what `Architecture guards` job enforces
