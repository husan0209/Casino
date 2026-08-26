# Branch Protection Setup

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
     - Search and add: `secrets-scan` (from `.github/workflows/ci.yml`)
     - Search and add: `commitlint` (from `.github/workflows/ci.yml`)
     - Search and add: `Architecture guards` (from `.github/workflows/architecture-guards.yml`)
   - [x] **Do not allow bypassing the above settings**
   - [x] **Require linear history** (no merge commits)
4. Repeat for `dev` branch if used.

## Required secrets (Settings → Secrets and variables → Actions)

| Secret | Used by | How to generate |
|--------|---------|-----------------|
| `VPS_HOST` | `deploy.yml` | Your VPS IP or hostname |
| `VPS_USER` | `deploy.yml` | SSH user (e.g. `deploy`) |
| `VPS_SSH_KEY` | `deploy.yml` | `ssh-keygen -t ed25519`, paste private key |

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

- `docs/AUDIT_REPORT.md` §6 — analysis of protection gaps
- `docs/QUALITY_GATES.md` §3.5 — note on not modifying `ci.yml`
- `.github/workflows/architecture-guards.yml` — what `Architecture guards` job enforces
