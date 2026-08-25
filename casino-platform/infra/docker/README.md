# Docker Images

## Security baseline

All **prod** images (`*.prod.Dockerfile`) run as the built-in `node` user (uid 1000)
from the `node:20-alpine` base image. This satisfies `SECURITY_CHECKLIST.md §Infra`
"Docker non-root" and `AUDIT_REPORT.md §N11`.

## Why dev images stay as root

The dev images (`api.Dockerfile`, `web.Dockerfile`, `admin.Dockerfile`) intentionally
run as root because:

1. **`pnpm install` writes to `node_modules/.pnpm/`** — running as non-root inside a
   bind-mounted dev volume would cause EACCES on the host.
2. **`prisma generate`** writes to `node_modules/.prisma/` and `prisma/generated/`
   during dev hot-reload.
3. **Hot-reload of node_modules** — Vite / Next.js / NestJS watch mode need to
   write into the workspace.

If you want non-root dev too, see the `compose.override.yml` pattern in the
[Docker docs](https://docs.docker.com/compose/extends/) — but for the current
Termux/Linux dev setup this breaks bind-mounts.

## Files

| File | Purpose | User |
|------|---------|------|
| `api.Dockerfile` | Dev image for `@casino/api` | root (see above) |
| `api.prod.Dockerfile` | Prod image (multi-stage) | **node** |
| `web.Dockerfile` | Dev image for `@casino/web` | root (see above) |
| `web.prod.Dockerfile` | Prod image (multi-stage) | **node** |
| `admin.Dockerfile` | Dev image for `@casino/admin` | root (see above) |
| `admin.prod.Dockerfile` | Prod image (multi-stage) | **node** |

## Verification

After build, check the user inside the container:

```bash
docker run --rm casino-api:test id
# expected: uid=1000(node) gid=1000(node) groups=1000(node)

docker run --rm casino-api:test ps aux
# expected: node as the only process (PID 1)
```
