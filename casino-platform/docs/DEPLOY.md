# Deploy – Casino Platform

## 1st deploy – Hetzner CX41 Ubuntu 24.04

```bash
# as root
curl -fsSL https://raw.githubusercontent.com/your/repo/main/infra/scripts/vps_init.sh | bash

su deploy
cd /opt
git clone https://github.com/your/casino-platform.git /opt/casino-platform
cd /opt/casino-platform
cp .env.example .env.production
# edit .env.production – set all secrets, JWT >=64 chars, DB_PASSWORD, REDIS_PASSWORD, RUKASSA_*, NOWPAYMENTS_*, SMTP_*, etc.
nano .env.production
ln -sf .env.production .env

# SSL first
docker compose -f docker-compose.prod.yml up -d postgres redis
# get certs
bash infra/scripts/ssl_init.sh

# full up
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec api npx prisma db seed

# check
curl https://casino.example.com/api/v1/health
```

## CI/CD
GitHub Actions:
- `.github/workflows/ci.yml` – lint, typecheck, test, build on push/PR
- `.github/workflows/deploy.yml` – SSH to VPS, git pull, docker compose build up, prisma migrate deploy

Required secrets in GitHub:
`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`

## Backup
Cron: `0 2 * * * /opt/casino-platform/infra/scripts/postgres-backup.sh`
Keeps 14 days in `/opt/casino-backups`, optionally sync to S3.

## Monitoring
- UptimeRobot → https://casino.example.com/api/v1/health
- Logs: `docker compose logs -f api`
- DB: `SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;`

## Rollback
```bash
cd /opt/casino-platform
git checkout <prev-tag>
docker compose -f docker-compose.prod.yml build api web admin
docker compose -f docker-compose.prod.yml up -d
```
DB rollback: restore from `/opt/casino-backups/casino_YYYY-MM-DD_HHMM.sql.gz`
