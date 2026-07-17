---
title: "ТЗ — Часть 7. DevOps, Security, Logging, QA, Release Prep"
part: 7
total_parts: 7
status: "final"
project: "Online Casino Platform"
stack: "NestJS + TypeScript + Prisma + PostgreSQL + Redis + Next.js"
created: "2026-06-19"
---

# ТЗ — Часть 7. DevOps, Security, Logging, QA, Release Prep

> **Прогресс ТЗ:** `7 / 7` ✅ — финальная часть
>
> **Все части ТЗ:**
> 1. [Foundation — monorepo, стек, архитектура](./tz-part-1-foundation.md)
> 2. [Backend Core — Auth, Users, KYC, RBAC](./tz-part-2-auth-users-kyc-rbac.md)
> 3. [Wallet, Fiat/Crypto Payments, Transaction Ledger](./tz-part-3-payments-wallet.md)
> 4. [Casino Providers, Game Sessions, Seamless Wallet API](./tz-part-4-casino-providers.md)
> 5. [Frontend Web — витрина, ЛК, кошелёк, история](./tz-part-5-frontend-web.md)
> 6. [Admin Panel, Support, Referral System](./tz-part-6-admin-support-referrals.md)
> 7. **DevOps, Security, Logging, QA, Release Prep** ← *вы здесь*

---

## Оглавление

1. [Цель этапа](#1-цель-этапа)
2. [Инфраструктура VPS](#2-инфраструктура-vps)
3. [Структура файлов деплоя](#3-структура-файлов-деплоя)
4. [Docker Configuration](#4-docker-configuration)
5. [Nginx Configuration](#5-nginx-configuration)
6. [SSL — Let's Encrypt](#6-ssl--lets-encrypt)
7. [Environment Variables](#7-environment-variables)
8. [Deployment Scripts](#8-deployment-scripts)
9. [CI/CD Pipeline](#9-cicd-pipeline)
10. [Health Module](#10-health-module)
11. [Logging](#11-logging)
12. [Мониторинг](#12-мониторинг)
13. [Безопасность](#13-безопасность)
14. [Тестирование](#14-тестирование)
15. [Release Preparation Checklist](#15-release-preparation-checklist)
16. [PostgreSQL Tuning](#16-postgresql-tuning)
17. [Disaster Recovery](#17-disaster-recovery)
18. [Итоговая структура всего ТЗ](#18-итоговая-структура-всего-тз)
19. [AI_DEVELOPMENT_RULES.md](#19-ai_development_rulesmd)

---

## 1. Цель этапа

Эта финальная часть описывает:

- инфраструктуру и деплой на VPS;
- конфигурацию Nginx;
- Docker и Docker Compose setup;
- CI/CD pipeline;
- безопасность на всех уровнях;
- логирование и мониторинг;
- резервное копирование;
- процедуры QA и тестирования;
- чеклист перед публичным запуском.

После этой части платформа готова к первому деплою и тестированию.

---

## 2. Инфраструктура VPS

### 2.1. Минимальные требования VPS для старта

```
CPU:      4 vCPU
RAM:      8 GB
Disk:     100 GB SSD
Network:  1 Gbps
OS:       Ubuntu 22.04 LTS
Location: Германия / Нидерланды / Финляндия
          (для СНГ аудитории оптимальная задержка)
```

### 2.2. Рекомендуемые провайдеры

```
Hetzner Cloud     — лучшее соотношение цена/качество для Европы
                    CX31: 2 vCPU, 8 GB RAM, 80 GB — ~€8/мес
                    CX41: 4 vCPU, 16 GB RAM, 160 GB — ~€15/мес

Contabo           — дешевле, но хуже поддержка
DigitalOcean      — удобнее, дороже
Vultr             — аналог DigitalOcean
OVH               — хорошо для DDOS защиты
```

> **Рекомендация для старта:** Hetzner CX41 (4 vCPU, 16 GB RAM).

### 2.3. Структура серверов

На MVP достаточно **одного VPS** со всеми сервисами.

```
VPS Server
├── Nginx (reverse proxy, SSL termination)
├── Docker
│   ├── api          (NestJS backend)
│   ├── web          (Next.js frontend)
│   ├── admin        (Next.js admin)
│   ├── postgres     (PostgreSQL)
│   ├── redis        (Redis)
│   └── (опционально) certbot
└── System services
    ├── UFW (firewall)
    ├── fail2ban
    └── unattended-upgrades
```

### 2.4. Настройка сервера с нуля

Последовательность действий при получении нового VPS:

#### Шаг 1: Базовая безопасность

```bash
# Создать нового пользователя (не root)
adduser deploy
usermod -aG sudo deploy

# Скопировать SSH ключи
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Отключить root SSH login
# В /etc/ssh/sshd_config:
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes

systemctl restart sshd
```

#### Шаг 2: Файрвол

```bash
# UFW настройка
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh          # 22
ufw allow http         # 80
ufw allow https        # 443
ufw enable

# Проверить
ufw status verbose
```

#### Шаг 3: Обновление системы

```bash
apt update && apt upgrade -y
apt install -y curl git htop nano fail2ban unattended-upgrades
```

#### Шаг 4: fail2ban

```bash
# /etc/fail2ban/jail.local
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = /var/log/auth.log

[nginx-http-auth]
enabled = true

systemctl enable fail2ban
systemctl start fail2ban
```

#### Шаг 5: Docker

```bash
# Установка Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Docker Compose plugin
apt install docker-compose-plugin

# Проверить
docker --version
docker compose version
```

---

## 3. Структура файлов деплоя

```
casino-platform/
  infra/
    docker/
      Dockerfile.api
      Dockerfile.web
      Dockerfile.admin
      nginx/
        nginx.conf
        sites/
          casino.conf          — основной конфиг сайта
          api.conf             — конфиг API
          admin.conf           — конфиг админки
    scripts/
      setup.sh                 — первоначальная настройка VPS
      deploy.sh                — деплой
      rollback.sh              — откат на предыдущую версию
      backup.sh                — резервное копирование БД
      restore.sh               — восстановление из бэкапа
      health-check.sh          — проверка здоровья сервисов
    ssl/
      .gitkeep                 — SSL сертификаты не в репо
  docker-compose.yml           — разработка
  docker-compose.prod.yml      — продакшн
  .env.example                 — шаблон переменных окружения
  .env.production.example      — шаблон prod переменных
```

---

## 4. Docker Configuration

### 4.1. Dockerfile для API

```dockerfile
# infra/docker/Dockerfile.api

# ── STAGE 1: Dependencies ──────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Копируем package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/

# Устанавливаем pnpm и зависимости
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# ── STAGE 2: Builder ───────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

RUN npm install -g pnpm

# Генерируем Prisma client
RUN pnpm --filter @casino/database generate

# Собираем shared пакеты
RUN pnpm --filter @casino/shared-types build
RUN pnpm --filter @casino/shared-utils build
RUN pnpm --filter @casino/shared-config build

# Собираем API
RUN pnpm --filter @casino/api build

# ── STAGE 3: Runner ────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Безопасность: не запускать от root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Копируем только необходимое
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages ./packages

USER nestjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1

CMD ["node", "dist/main.js"]
```

### 4.2. Dockerfile для Web

```dockerfile
# infra/docker/Dockerfile.web

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY apps/web/package.json ./apps/web/
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm install -g pnpm
RUN pnpm --filter @casino/shared-types build
RUN pnpm --filter @casino/shared-utils build

ENV NEXT_TELEMETRY_DISABLED 1
RUN pnpm --filter @casino/web build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
```

### 4.3. Dockerfile для Admin

Аналогичен Dockerfile.web, порт 3002.

### 4.4. Docker Compose — Production

```yaml
# docker-compose.prod.yml

version: '3.9'

networks:
  casino-network:
    driver: bridge

volumes:
  postgres-data:
  redis-data:
  uploads-data:
  logs-data:

services:

  # ── PostgreSQL ──────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    networks:
      - casino-network
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
    # НЕ открывать порт наружу в продакшне
    # ports: # убрать в prod
    #   - "5432:5432"

  # ── Redis ───────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    networks:
      - casino-network
    volumes:
      - redis-data:/data
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --appendonly yes
      --appendfsync everysec
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    # НЕ открывать порт наружу

  # ── API ─────────────────────────────────────────────────
  api:
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.api
    restart: unless-stopped
    networks:
      - casino-network
    volumes:
      - uploads-data:/app/uploads
      - logs-data:/app/logs
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
    env_file:
      - .env.production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/api/v1/health"]
      interval: 30s
      timeout: 10s
      start_period: 40s
      retries: 3

  # ── Web ─────────────────────────────────────────────────
  web:
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.web
    restart: unless-stopped
    networks:
      - casino-network
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_URL: https://${DOMAIN}/api/v1
      NEXT_PUBLIC_WS_URL: wss://${DOMAIN}
    env_file:
      - .env.production
    depends_on:
      - api

  # ── Admin ───────────────────────────────────────────────
  admin:
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.admin
    restart: unless-stopped
    networks:
      - casino-network
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_URL: https://${DOMAIN}/api/v1
    env_file:
      - .env.production
    depends_on:
      - api

  # ── Nginx ───────────────────────────────────────────────
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    networks:
      - casino-network
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infra/docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./infra/docker/nginx/sites:/etc/nginx/sites-enabled:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - /var/www/certbot:/var/www/certbot:ro
      - logs-data:/var/log/nginx
    depends_on:
      - api
      - web
      - admin
```

### 4.5. Docker Compose — Development

```yaml
# docker-compose.yml

version: '3.9'

networks:
  casino-dev:
    driver: bridge

volumes:
  postgres-dev-data:
  redis-dev-data:

services:

  postgres:
    image: postgres:16-alpine
    networks:
      - casino-dev
    ports:
      - "5432:5432"
    volumes:
      - postgres-dev-data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: casino_dev
      POSTGRES_USER: casino
      POSTGRES_PASSWORD: casino_dev_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U casino"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    networks:
      - casino-dev
    ports:
      - "6379:6379"
    volumes:
      - redis-dev-data:/data
    command: redis-server --appendonly yes

  # В dev режиме api/web/admin запускаются локально через pnpm dev
  # Только БД и Redis в Docker
```

---

## 5. Nginx Configuration

### 5.1. Основной конфиг

```nginx
# infra/docker/nginx/nginx.conf

user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 2048;
    multi_accept on;
    use epoll;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # ── Логирование ────────────────────────────────────────
    log_format main '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent" '
                    '$request_time $upstream_response_time';

    access_log /var/log/nginx/access.log main;

    # ── Производительность ─────────────────────────────────
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 20M;

    # ── Gzip ──────────────────────────────────────────────
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1000;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/x-javascript
        image/svg+xml;

    # ── Security Headers ───────────────────────────────────
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # ── Rate Limiting Zones ────────────────────────────────
    limit_req_zone $binary_remote_addr zone=api_general:10m rate=60r/m;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
    limit_req_zone $binary_remote_addr zone=webhooks:10m rate=100r/m;

    # ── Upstream ───────────────────────────────────────────
    upstream api_backend {
        server api:3001;
        keepalive 32;
    }

    upstream web_frontend {
        server web:3000;
        keepalive 16;
    }

    upstream admin_frontend {
        server admin:3002;
        keepalive 8;
    }

    include /etc/nginx/sites-enabled/*.conf;
}
```

### 5.2. Основной сайт

```nginx
# infra/docker/nginx/sites/casino.conf

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name casino.example.com www.casino.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# Main HTTPS
server {
    listen 443 ssl http2;
    server_name casino.example.com www.casino.example.com;

    # SSL
    ssl_certificate /etc/letsencrypt/live/casino.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/casino.example.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Современные cipher suites
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # CSP Header
    add_header Content-Security-Policy "
        default-src 'self';
        script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://telegram.org;
        style-src 'self' 'unsafe-inline';
        img-src 'self' data: https:;
        font-src 'self';
        connect-src 'self' https://api.casino.example.com wss://casino.example.com;
        frame-src 'self' https:;
    " always;

    # ── API ─────────────────────────────────────────────
    location /api/v1/ {
        # Auth endpoints — строгий rate limit
        location /api/v1/auth/ {
            limit_req zone=auth burst=5 nodelay;
            limit_req_status 429;
            proxy_pass http://api_backend;
            include /etc/nginx/snippets/proxy_params.conf;
        }

        # Webhook endpoints — более мягкий лимит
        location /api/v1/payments/webhooks/ {
            limit_req zone=webhooks burst=50 nodelay;
            proxy_pass http://api_backend;
            include /etc/nginx/snippets/proxy_params.conf;
        }

        # Общий rate limit для API
        limit_req zone=api_general burst=20 nodelay;
        proxy_pass http://api_backend;
        include /etc/nginx/snippets/proxy_params.conf;
    }

    # ── Static files (Next.js) ──────────────────────────
    location /_next/static/ {
        proxy_pass http://web_frontend;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # ── Web App ─────────────────────────────────────────
    location / {
        proxy_pass http://web_frontend;
        include /etc/nginx/snippets/proxy_params.conf;
    }
}

# Admin — отдельный subdomain
server {
    listen 443 ssl http2;
    server_name admin.casino.example.com;

    ssl_certificate /etc/letsencrypt/live/casino.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/casino.example.com/privkey.pem;

    # Restrict admin to specific IPs (рекомендуется)
    # allow 1.2.3.4;   # ваш IP
    # deny all;

    location / {
        proxy_pass http://admin_frontend;
        include /etc/nginx/snippets/proxy_params.conf;
    }
}
```

### 5.3. Proxy Params

```nginx
# infra/docker/nginx/snippets/proxy_params.conf

proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection 'upgrade';
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Request-ID $request_id;
proxy_cache_bypass $http_upgrade;
proxy_connect_timeout 30s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
```

---

## 6. SSL — Let's Encrypt

### 6.1. Первичное получение сертификата

```bash
# Установить certbot
apt install certbot python3-certbot-nginx

# Получить сертификат
certbot certonly --standalone \
  -d casino.example.com \
  -d www.casino.example.com \
  -d admin.casino.example.com \
  --email admin@casino.example.com \
  --agree-tos \
  --non-interactive

# Сертификаты будут в /etc/letsencrypt/live/casino.example.com/
```

### 6.2. Автоматическое обновление

```bash
# Создать systemd timer или cron job
crontab -e

# Добавить:
0 3 * * * certbot renew --quiet && docker compose -f /app/docker-compose.prod.yml exec nginx nginx -s reload
```

---

## 7. Environment Variables

### 7.1. Полный .env.example

```bash
# ── Application ────────────────────────────────────────────
NODE_ENV=production
APP_PORT=3001
APP_URL=https://casino.example.com
ADMIN_URL=https://admin.casino.example.com
DOMAIN=casino.example.com

# ── Database ───────────────────────────────────────────────
DB_HOST=postgres
DB_PORT=5432
DB_NAME=casino_prod
DB_USER=casino_prod_user
DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}

# ── Redis ──────────────────────────────────────────────────
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=CHANGE_ME_REDIS_PASSWORD
REDIS_URL=redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}

# ── JWT ────────────────────────────────────────────────────
JWT_ACCESS_SECRET=CHANGE_ME_VERY_LONG_RANDOM_STRING_64_CHARS
JWT_REFRESH_SECRET=CHANGE_ME_ANOTHER_VERY_LONG_RANDOM_STRING
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# ── Google OAuth ───────────────────────────────────────────
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=https://casino.example.com/api/v1/auth/google/callback

# ── Telegram ───────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_BOT_NAME=your_casino_bot

# ── Rukassa ────────────────────────────────────────────────
RUKASSA_SHOP_ID=your_shop_id
RUKASSA_API_KEY=your_api_key
RUKASSA_SECRET_KEY=your_secret_key
RUKASSA_API_URL=https://lk.rukassa.is/api/v1
RUKASSA_WEBHOOK_URL=https://casino.example.com/api/v1/payments/webhooks/rukassa
RUKASSA_SUCCESS_URL=https://casino.example.com/wallet?deposit=success
RUKASSA_FAIL_URL=https://casino.example.com/wallet?deposit=failed

# ── NOWPayments ────────────────────────────────────────────
NOWPAYMENTS_API_KEY=your_nowpayments_api_key
NOWPAYMENTS_IPN_SECRET=your_ipn_secret
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
NOWPAYMENTS_WEBHOOK_URL=https://casino.example.com/api/v1/payments/webhooks/nowpayments

# ── Email / SMTP ───────────────────────────────────────────
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=your_resend_api_key
SMTP_FROM_EMAIL=noreply@casino.example.com
SMTP_FROM_NAME=Casino Support

# ── KYC ────────────────────────────────────────────────────
KYC_DEPOSIT_LIMIT_RUB=5000

# ── Referral ───────────────────────────────────────────────
REFERRAL_REWARD_RATE=0.05
REFERRAL_ENABLED=true

# ── Upload ─────────────────────────────────────────────────
UPLOAD_DIR=/app/uploads
UPLOAD_MAX_SIZE_MB=10
UPLOAD_ALLOWED_TYPES=jpg,jpeg,png,pdf,webp

# ── Rate Limiting ──────────────────────────────────────────
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=60

# ── Logging ────────────────────────────────────────────────
LOG_LEVEL=info
LOG_FORMAT=json
LOG_DIR=/app/logs

# ── Seeding (только для первоначальной настройки) ──────────
SEED_ADMIN_EMAIL=superadmin@casino.example.com
SEED_ADMIN_PASSWORD=CHANGE_ME_ADMIN_PASSWORD

# ── Internal Auth (для inter-service коммуникации) ─────────
INTERNAL_API_SECRET=CHANGE_ME_INTERNAL_SECRET

# ── Frontend env (для Next.js) ─────────────────────────────
NEXT_PUBLIC_API_URL=https://casino.example.com/api/v1
NEXT_PUBLIC_DOMAIN=casino.example.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
NEXT_PUBLIC_TELEGRAM_BOT_NAME=your_casino_bot
```

---

## 8. Deployment Scripts

### 8.1. Deploy Script

```bash
#!/bin/bash
# infra/scripts/deploy.sh

set -euo pipefail

# Конфигурация
APP_DIR="/home/deploy/casino-platform"
COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_BEFORE_DEPLOY=true

echo "🚀 Starting deployment..."
echo "📅 $(date)"

# ── Шаг 1: Бэкап БД перед деплоем ─────────────────────────
if [ "$BACKUP_BEFORE_DEPLOY" = true ]; then
    echo "💾 Creating pre-deploy backup..."
    bash "$APP_DIR/infra/scripts/backup.sh"
fi

# ── Шаг 2: Обновить код ────────────────────────────────────
echo "📦 Pulling latest code..."
cd "$APP_DIR"
git fetch origin
git pull origin main

# ── Шаг 3: Загрузить переменные окружения ─────────────────
if [ ! -f ".env.production" ]; then
    echo "❌ .env.production not found!"
    exit 1
fi

# ── Шаг 4: Собрать новые образы ───────────────────────────
echo "🔨 Building Docker images..."
docker compose -f "$COMPOSE_FILE" build --no-cache

# ── Шаг 5: Остановить старые контейнеры ───────────────────
echo "⏸️  Stopping old containers..."
docker compose -f "$COMPOSE_FILE" down --timeout 30

# ── Шаг 6: Применить миграции ─────────────────────────────
echo "🗃️  Running database migrations..."
docker compose -f "$COMPOSE_FILE" run --rm api \
    node -e "require('./dist/scripts/migrate').runMigrations()"

# Или через Prisma напрямую:
# docker run --rm \
#   --env-file .env.production \
#   --network casino-network \
#   casino-api npx prisma migrate deploy

# ── Шаг 7: Запустить новые контейнеры ─────────────────────
echo "▶️  Starting new containers..."
docker compose -f "$COMPOSE_FILE" up -d

# ── Шаг 8: Подождать health check ─────────────────────────
echo "🏥 Waiting for health checks..."
sleep 15

# ── Шаг 9: Проверить что всё запустилось ─────────────────
bash "$APP_DIR/infra/scripts/health-check.sh"

# ── Шаг 10: Очистить старые образы ────────────────────────
echo "🧹 Cleaning up old images..."
docker image prune -f

echo "✅ Deployment completed successfully!"
echo "📅 $(date)"
```

### 8.2. Health Check Script

```bash
#!/bin/bash
# infra/scripts/health-check.sh

set -euo pipefail

DOMAIN="${DOMAIN:-casino.example.com}"
MAX_RETRIES=10
RETRY_INTERVAL=5

check_endpoint() {
    local name="$1"
    local url="$2"
    local retries=0

    echo "Checking $name..."

    while [ $retries -lt $MAX_RETRIES ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            echo "  ✅ $name is healthy"
            return 0
        fi

        retries=$((retries + 1))
        echo "  ⏳ Waiting... ($retries/$MAX_RETRIES)"
        sleep "$RETRY_INTERVAL"
    done

    echo "  ❌ $name failed health check!"
    return 1
}

echo "🏥 Running health checks..."

check_endpoint "API" "http://localhost:3001/api/v1/health"
check_endpoint "Web" "http://localhost:3000"
check_endpoint "Admin" "http://localhost:3002"

# Проверка что nginx проксирует правильно
check_endpoint "API via Nginx" "https://$DOMAIN/api/v1/health"

# Проверка БД через API health endpoint
API_HEALTH=$(curl -sf "http://localhost:3001/api/v1/health/details" || echo '{}')
DB_STATUS=$(echo "$API_HEALTH" | grep -o '"database":"[^"]*"' | cut -d'"' -f4)
REDIS_STATUS=$(echo "$API_HEALTH" | grep -o '"redis":"[^"]*"' | cut -d'"' -f4)

if [ "$DB_STATUS" = "ok" ]; then
    echo "  ✅ Database connection: OK"
else
    echo "  ❌ Database connection: FAILED"
    exit 1
fi

if [ "$REDIS_STATUS" = "ok" ]; then
    echo "  ✅ Redis connection: OK"
else
    echo "  ❌ Redis connection: FAILED"
    exit 1
fi

echo ""
echo "✅ All health checks passed!"
```

### 8.3. Backup Script

```bash
#!/bin/bash
# infra/scripts/backup.sh

set -euo pipefail

BACKUP_DIR="/home/deploy/backups"
DB_CONTAINER="casino-postgres-1"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/casino_db_$TIMESTAMP.sql.gz"
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"

echo "💾 Starting database backup..."
echo "📅 Timestamp: $TIMESTAMP"

# Создать дамп БД
docker exec "$DB_CONTAINER" \
    pg_dump -U "$DB_USER" "$DB_NAME" | \
    gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "✅ Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# Удалить старые бэкапы
find "$BACKUP_DIR" -name "casino_db_*.sql.gz" \
    -mtime "+$RETENTION_DAYS" -delete

echo "🧹 Old backups cleaned (kept last $RETENTION_DAYS days)"

# Показать список бэкапов
echo "📋 Current backups:"
ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "  No backups found"

echo "✅ Backup completed!"
```

### 8.4. Rollback Script

```bash
#!/bin/bash
# infra/scripts/rollback.sh

set -euo pipefail

APP_DIR="/home/deploy/casino-platform"
COMPOSE_FILE="docker-compose.prod.yml"

echo "⏮️  Starting rollback..."

cd "$APP_DIR"

# Откат к предыдущему git commit
CURRENT_COMMIT=$(git rev-parse HEAD)
PREVIOUS_COMMIT=$(git rev-parse HEAD~1)

echo "📌 Current commit: $CURRENT_COMMIT"
echo "📌 Rolling back to: $PREVIOUS_COMMIT"

git checkout "$PREVIOUS_COMMIT"

# Пересобрать и перезапустить
docker compose -f "$COMPOSE_FILE" build
docker compose -f "$COMPOSE_FILE" down --timeout 30
docker compose -f "$COMPOSE_FILE" up -d

sleep 15
bash "$APP_DIR/infra/scripts/health-check.sh"

echo "✅ Rollback completed to $PREVIOUS_COMMIT"
```

---

## 9. CI/CD Pipeline

### 9.1. GitHub Actions

```yaml
# .github/workflows/deploy.yml

name: Deploy to Production

on:
  push:
    branches:
      - main

env:
  NODE_VERSION: '20'

jobs:

  # ── Проверка кода ─────────────────────────────────────────
  lint-and-type-check:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run linting
        run: pnpm lint

      - name: Run type checking
        run: pnpm typecheck

  # ── Тесты ────────────────────────────────────────────────
  test:
    name: Run Tests
    runs-on: ubuntu-latest
    needs: lint-and-type-check

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: casino_test
          POSTGRES_USER: casino_test
          POSTGRES_PASSWORD: casino_test_password
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm --filter @casino/database generate
        env:
          DATABASE_URL: postgresql://casino_test:casino_test_password@localhost:5432/casino_test

      - name: Run migrations
        run: pnpm --filter @casino/database migrate:deploy
        env:
          DATABASE_URL: postgresql://casino_test:casino_test_password@localhost:5432/casino_test

      - name: Run unit tests
        run: pnpm test
        env:
          DATABASE_URL: postgresql://casino_test:casino_test_password@localhost:5432/casino_test
          REDIS_URL: redis://localhost:6379
          JWT_ACCESS_SECRET: test_secret_for_ci
          JWT_REFRESH_SECRET: test_refresh_secret_for_ci

      - name: Upload test coverage
        uses: codecov/codecov-action@v4
        if: always()

  # ── Сборка Docker образов ─────────────────────────────────
  build:
    name: Build Docker Images
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build API image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: infra/docker/Dockerfile.api
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build Web image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: infra/docker/Dockerfile.web
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build Admin image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: infra/docker/Dockerfile.admin
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ── Деплой на VPS ─────────────────────────────────────────
  deploy:
    name: Deploy to VPS
    runs-on: ubuntu-latest
    needs: build
    environment: production

    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /home/deploy/casino-platform
            bash infra/scripts/deploy.sh
```

### 9.2. GitHub Secrets

Настроить в Settings → Secrets and Variables → Actions:

```
VPS_HOST              — IP адрес VPS
VPS_SSH_KEY           — приватный SSH ключ для деплоя
```

---

## 10. Health Module

### 10.1. Backend Health Endpoints

#### UC-HEALTH-01: Базовый health check

```
GET /api/v1/health
```

**Ответ:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0"
}
```

#### UC-HEALTH-02: Детальный health check

```
GET /api/v1/health/details
```

Только для internal network или с internal auth.

**Ответ:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0",
  "services": {
    "database": "ok",
    "redis": "ok",
    "email_queue": "ok"
  },
  "queues": {
    "email": { "waiting": 0, "active": 0, "failed": 2 },
    "notifications": { "waiting": 0, "active": 0, "failed": 0 }
  },
  "uptime": 86400
}
```

---

## 11. Logging

### 11.1. Настройка logger

Использовать `pino` для structured JSON logging в NestJS.

```typescript
// Конфигурация logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    service: 'casino-api',
    version: process.env.npm_package_version,
    env: process.env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})
```

### 11.2. Что и как логировать

#### Уровни логов

```
error   — критические ошибки (payment failures, DB errors)
warn    — предупреждения (invalid webhook signature, rate limit hit)
info    — важные события (user login, deposit completed, KYC status changed)
debug   — детальная отладка (только в development)
```

#### Обязательные поля в каждом логе

```json
{
  "level": "info",
  "time": "2024-01-01T15:30:00.000Z",
  "service": "casino-api",
  "env": "production",
  "requestId": "uuid-v4",
  "userId": "user-uuid or null",
  "module": "wallet",
  "action": "deposit_completed",
  "message": "Deposit completed successfully",
  "data": {}
}
```

#### Что логировать

```
Финансовые события (level: info):
  - deposit_initiated
  - deposit_completed
  - deposit_failed
  - withdrawal_requested
  - withdrawal_approved
  - withdrawal_rejected
  - balance_credited
  - balance_debited
  - wallet_lock
  - wallet_unlock

Аутентификация (level: info):
  - user_registered
  - user_login_success
  - user_login_failed
  - user_logout
  - token_refreshed
  - password_changed
  - google_oauth_login
  - telegram_login

Безопасность (level: warn):
  - invalid_webhook_signature
  - rate_limit_exceeded
  - invalid_jwt_token
  - access_denied
  - suspicious_activity

Провайдеры (level: info):
  - provider_callback_received
  - provider_callback_processed
  - game_session_created
  - game_session_closed
  - bet_processed
  - win_credited
  - rollback_processed

Ошибки (level: error):
  - database_error
  - redis_error
  - payment_provider_error
  - unhandled_exception
  - migration_failed
```

### 11.3. Ротация логов

Логи сохраняются в `/app/logs/`.

Настроить ротацию через logrotate:

```bash
# /etc/logrotate.d/casino

/home/deploy/casino-platform/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su deploy deploy
}
```

---

## 12. Мониторинг

### 12.1. Простой мониторинг для MVP

На MVP не нужен полноценный стек Prometheus + Grafana.

Достаточно:

- **UptimeRobot** (бесплатно) — мониторинг доступности;
- **health check endpoints** — проверка сервисов;
- **log monitoring** — просмотр логов вручную или через простой инструмент;
- **disk/RAM/CPU alerts** — через встроенные инструменты VPS.

### 12.2. UptimeRobot настройка

Создать мониторы:

```
Monitor 1: API Health
  URL: https://casino.example.com/api/v1/health
  Interval: 5 minutes
  Alert: email + telegram

Monitor 2: Web Frontend
  URL: https://casino.example.com
  Interval: 5 minutes

Monitor 3: Admin Panel
  URL: https://admin.casino.example.com
  Interval: 5 minutes
```

### 12.3. Cron job для мониторинга ресурсов

```bash
# Добавить в crontab
*/5 * * * * /home/deploy/casino-platform/infra/scripts/resource-check.sh
```

```bash
#!/bin/bash
# infra/scripts/resource-check.sh

CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
RAM_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | cut -d'%' -f1)

# Алерты при превышении порогов
if [ "$CPU_USAGE" -gt 85 ]; then
    echo "ALERT: High CPU usage: ${CPU_USAGE}%" | mail -s "Casino Alert: High CPU" admin@casino.example.com
fi

if [ "$RAM_USAGE" -gt 90 ]; then
    echo "ALERT: High RAM usage: ${RAM_USAGE}%" | mail -s "Casino Alert: High RAM" admin@casino.example.com
fi

if [ "$DISK_USAGE" -gt 85 ]; then
    echo "ALERT: High disk usage: ${DISK_USAGE}%" | mail -s "Casino Alert: High Disk" admin@casino.example.com
fi
```

---

## 13. Безопасность

### 13.1. Backend Security Checklist

#### NestJS конфигурация

```typescript
// main.ts — security setup

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // Helmet — security headers
  app.use(helmet({
    contentSecurityPolicy: false, // настроено в Nginx
    crossOriginEmbedderPolicy: false,
  }))

  // CORS
  app.enableCors({
    origin: [
      process.env.APP_URL,
      process.env.ADMIN_URL,
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  })

  // Отключить заголовок X-Powered-By
  app.getHttpAdapter().getInstance().disable('x-powered-by')

  // Validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,         // убирает лишние поля из DTO
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
  }))

  // Throttler (rate limiting)
  // настраивается через ThrottlerModule
}
```

#### Защита endpoints

```
Правила доступа:
  Публичные (без auth):
    GET /api/v1/health
    GET /api/v1/health/details
    GET /api/v1/casino/games
    GET /api/v1/casino/games/:slug
    GET /api/v1/casino/providers
    GET /api/v1/casino/categories
    POST /api/v1/auth/register
    POST /api/v1/auth/login
    POST /api/v1/auth/refresh
    GET /api/v1/auth/verify-email
    POST /api/v1/auth/forgot-password
    POST /api/v1/auth/reset-password
    GET /api/v1/auth/google
    GET /api/v1/auth/google/callback
    POST /api/v1/auth/telegram
    POST /api/v1/casino/games/:slug/demo
    POST /api/v1/payments/webhooks/*  (своя auth через signature)

  Приватные (user auth required):
    Все остальные /api/v1/* endpoints

  Admin only:
    Все /api/v1/admin/* endpoints

  Superadmin only:
    /api/v1/admin/admins/*
    /api/v1/admin/settings/*
    /api/v1/admin/wallet/:user_id/credit
    /api/v1/admin/wallet/:user_id/debit

  Internal (provider callbacks):
    /api/v1/provider-callback/*
```

### 13.2. Database Security

```sql
-- Создать отдельного DB пользователя только с нужными правами
CREATE USER casino_prod_user WITH PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE casino_prod TO casino_prod_user;
GRANT USAGE ON SCHEMA public TO casino_prod_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO casino_prod_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO casino_prod_user;

-- НЕ давать права DROP, CREATE TABLE, TRUNCATE
-- Миграции запускать от отдельного migration пользователя
```

### 13.3. Secrets Management

> **Правила:**
>
> - никогда не коммитить `.env` файлы в репозиторий;
> - добавить в `.gitignore`:
>   ```
>   .env
>   .env.local
>   .env.production
>   .env.staging
>   *.pem
>   *.key
>   ```
> - хранить production secrets в:
>   - GitHub Secrets (для CI/CD);
>   - защищённый файл на сервере `/home/deploy/.env.production`;
> - JWT secrets генерировать через `openssl rand -hex 64`.

### 13.4. Input Validation

Все входные данные должны проходить валидацию через Zod или class-validator:

- обязательное whitelist-ing в ValidationPipe;
- максимальная длина строк;
- паттерны для специфичных полей (email, wallet addresses, phone);
- sanitization HTML/SQL не нужна при правильном использовании Prisma и parameterized queries.

### 13.5. File Upload Security

```typescript
// Настройка multer для безопасной загрузки файлов

const upload = multer({
  storage: multer.diskStorage({
    destination: process.env.UPLOAD_DIR,
    filename: (req, file, cb) => {
      // Генерировать случайное имя, не использовать оригинальное
      const randomName = crypto.randomBytes(16).toString('hex')
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `${randomName}${ext}`)
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type'), false)
    }
  },
})
```

Дополнительно:

- файлы KYC и support вложения хранить вне публичной директории;
- доступ только через signed route с проверкой прав;
- проверять MIME type файла, не только расширение.

---

## 14. Тестирование

### 14.1. Стратегия тестирования

Для AI-разработки:

```
Unit Tests      — тестировать business logic (services, use cases)
Integration Tests — тестировать работу с БД (repositories)
E2E Tests       — тестировать ключевые флоу (deposit, bet, win)
```

На MVP:

- обязательно: unit tests для критичных сервисов;
- обязательно: integration tests для wallet операций;
- желательно: E2E для deposit flow и auth flow.

### 14.2. Настройка тестов

Использовать `vitest` для unit и integration тестов.

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/migrations/**',
      ],
    },
    setupFiles: ['./test/setup.ts'],
  },
})
```

### 14.3. Unit Tests — Что тестировать обязательно

#### WalletService

```typescript
describe('WalletService', () => {
  describe('credit', () => {
    it('должен зачислить сумму на баланс')
    it('должен создать запись в ledger')
    it('должен вернуть предыдущий результат при дублировании idempotency key')
    it('должен корректно обновить balance_before и balance_after')
    it('должен обработать concurrent requests без double-credit')
  })

  describe('debit', () => {
    it('должен списать сумму с баланса')
    it('должен вернуть INSUFFICIENT_FUNDS если баланс недостаточен')
    it('должен вернуть предыдущий результат при дублировании idempotency key')
    it('не должен списывать заблокированные средства')
  })

  describe('lock / unlock', () => {
    it('должен заблокировать средства')
    it('должен уменьшить доступный баланс')
    it('должен разблокировать средства при unlock')
  })

  describe('confirmWithdrawal', () => {
    it('должен списать баланс и locked одновременно')
    it('не должен допускать отрицательный locked')
  })
})
```

#### AuthService

```typescript
describe('AuthService', () => {
  describe('register', () => {
    it('должен создать пользователя с хешированным паролем')
    it('должен сгенерировать реферальный код')
    it('должен привязать реферала если код валиден')
    it('должен вернуть EMAIL_ALREADY_EXISTS при дублировании email')
    it('не должен хранить пароль в открытом виде')
  })

  describe('login', () => {
    it('должен вернуть токены при валидных credentials')
    it('должен вернуть INVALID_CREDENTIALS при неверном пароле')
    it('должен вернуть EMAIL_NOT_VERIFIED если email не подтверждён')
    it('должен вернуть ACCOUNT_BLOCKED для заблокированных')
  })

  describe('refresh', () => {
    it('должен выдать новый access token')
    it('должен ротировать refresh token')
    it('должен вернуть ошибку для использованного refresh token')
    it('должен вернуть ошибку для истёкшего token')
  })
})
```

#### GameCallbackService

```typescript
describe('GameCallbackService', () => {
  describe('processBet', () => {
    it('должен списать ставку с баланса')
    it('должен создать game_transaction')
    it('должен обновить game_round')
    it('должен вернуть текущий баланс при дублировании transaction_id')
    it('должен вернуть ошибку провайдера при INSUFFICIENT_FUNDS')
  })

  describe('processWin', () => {
    it('должен зачислить выигрыш на баланс')
    it('должен не зачислять при winAmount = 0')
    it('должен обработать дублирование идемпотентно')
  })

  describe('processRollback', () => {
    it('должен вернуть сумму ставки')
    it('должен обработать rollback несуществующей транзакции')
    it('должен не дублировать rollback')
  })
})
```

### 14.4. Integration Tests

Для integration тестов использовать тестовую БД:

```typescript
// test/setup.ts
import { PrismaClient } from '@casino/database'

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_TEST,
    },
  },
})

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  // Очистить данные перед каждым тестом
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany(),
    prisma.walletAccount.deleteMany(),
    prisma.gameTransaction.deleteMany(),
    // ...
  ])
})
```

### 14.5. Manual QA Checklist

Перед запуском проверить вручную или через AI-агент:

#### Auth Flow

```
[ ] Регистрация через email работает
[ ] Письмо с подтверждением приходит
[ ] Верификация email работает
[ ] Вход работает
[ ] Неверный пароль возвращает корректную ошибку
[ ] Rate limit на login работает (после 10 попыток)
[ ] Forgot password работает
[ ] Reset password работает
[ ] После reset — старый пароль не работает
[ ] Google OAuth работает (register + login)
[ ] Telegram login работает
[ ] Refresh token работает
[ ] Logout инвалидирует сессию
[ ] Заблокированный пользователь не может войти
```

#### Wallet Flow

```
[ ] Баланс отображается корректно
[ ] Дублированная операция не дублирует зачисление (idempotency)
[ ] INSUFFICIENT_FUNDS возвращается корректно
[ ] Lock/unlock корректно меняет available balance
[ ] История транзакций пагинируется
[ ] Фильтры истории работают
```

#### Payment Flow (Fiat)

```
[ ] Депозит создаёт payment_request
[ ] Rukassa callback с валидной подписью зачисляет средства
[ ] Rukassa callback с невалидной подписью игнорируется (не зачисляет)
[ ] Дублированный callback не дублирует зачисление
[ ] KYC лимит 5000 RUB работает корректно
[ ] Вывод создаёт заявку и блокирует средства
[ ] Admin approve списывает заблокированные средства
[ ] Admin reject разблокирует средства
[ ] Пользователь не может вывести без KYC
```

#### Payment Flow (Crypto)

```
[ ] NOWPayments депозит создаёт адрес и сумму
[ ] IPN callback с валидным HMAC зачисляет средства
[ ] IPN callback с невалидным HMAC игнорируется
[ ] actually_paid зачисляется, не requested
[ ] Expired платёж корректно обрабатывается
[ ] Крипто вывод создаёт заявку
```

#### Game Flow

```
[ ] Каталог игр отображается
[ ] Фильтры каталога работают
[ ] Демо запускается без авторизации
[ ] Игра запускается для авторизованного пользователя
[ ] Authenticate callback возвращает баланс
[ ] Bet callback списывает баланс
[ ] Win callback зачисляет баланс
[ ] Rollback возвращает ставку
[ ] Дублированные callbacks идемпотентны
[ ] История ставок отображается
```

#### KYC Flow

```
[ ] Форма KYC отправляется
[ ] Документы загружаются
[ ] Статус KYC отображается корректно
[ ] Admin видит заявку
[ ] Admin может одобрить (пользователь получает уведомление)
[ ] Admin может отклонить (пользователь получает уведомление)
[ ] После одобрения — лимит снят
[ ] Вывод требует KYC в любом случае
```

#### Support Flow

```
[ ] Тикет создаётся
[ ] Пользователь видит свои тикеты
[ ] Пользователь может ответить
[ ] Admin видит все тикеты
[ ] Admin может ответить
[ ] Internal note не видна пользователю
[ ] Статус тикета меняется корректно
[ ] Уведомление на email при ответе
```

#### Referral Flow

```
[ ] Реферальный код генерируется при регистрации
[ ] Регистрация с кодом привязывает реферала
[ ] Пользователь видит свою статистику
[ ] Ежедневный job начисляет вознаграждения
[ ] Admin видит статистику рефералов
```

#### Admin Panel

```
[ ] Отдельный login работает
[ ] Обычный admin не видит superadmin секции
[ ] Дашборд отображает актуальные метрики
[ ] Пользователи видны с фильтрами
[ ] Блокировка работает (сессии инвалидируются)
[ ] Ручная корректировка баланса записывается в audit
[ ] KYC review работает
[ ] Список выводов с массовыми действиями работает
[ ] Audit logs отображаются
[ ] Настройки сохраняются
```

---

## 15. Release Preparation Checklist

### 15.1. Инфраструктура

```
[ ] VPS настроен (UFW, fail2ban, SSH key auth)
[ ] Docker и Docker Compose установлены
[ ] SSL сертификаты получены и настроены
[ ] Nginx конфиг проверен (nginx -t)
[ ] Автоматическое обновление SSL настроено
[ ] Backup script работает и проверен
[ ] Health check script работает
[ ] Deploy script протестирован
[ ] .env.production настроен на сервере
[ ] Логи ротируются
[ ] UptimeRobot мониторинг настроен
```

### 15.2. База данных

```
[ ] Миграции применены
[ ] Seed запущен (admin пользователь создан)
[ ] Индексы проверены (EXPLAIN ANALYZE для ключевых запросов)
[ ] PostgreSQL параметры настроены под доступную RAM
[ ] Бэкап тестово восстановлен (restore.sh проверен)
```

### 15.3. Безопасность

```
[ ] Все secrets сгенерированы (не дефолтные значения)
[ ] JWT secrets длиной >= 64 символа
[ ] DB пароль сложный
[ ] Redis пароль установлен
[ ] .env файлы в .gitignore
[ ] CORS origins настроены только на свои домены
[ ] Admin panel доступен только с known IP (опционально)
[ ] Rate limiting проверен
[ ] Заголовки безопасности проверены (securityheaders.com)
```

### 15.4. Интеграции

```
[ ] Rukassa credentials настроены
[ ] Rukassa webhook URL зарегистрирован у провайдера
[ ] NOWPayments API key настроен
[ ] NOWPayments IPN URL зарегистрирован
[ ] Тестовый депозит через Rukassa выполнен (sandbox)
[ ] Тестовый крипто-депозит выполнен (небольшая сумма)
[ ] Google OAuth callback URL зарегистрирован
[ ] Telegram bot настроен
[ ] SMTP работает (тестовое письмо отправлено)
```

### 15.5. Приложения

```
[ ] API отвечает на /health
[ ] Web загружается
[ ] Admin panel загружается
[ ] Регистрация + вход работают end-to-end
[ ] Игры отображаются в каталоге
[ ] Demo режим работает
[ ] Кошелёк отображает балансы
[ ] Admin может войти и видит данные
```

### 15.6. Юридическое (напоминание)

```
[ ] Страница "Условия использования" добавлена
[ ] Страница "Политика конфиденциальности" добавлена
[ ] Страница "Ответственная игра" добавлена
[ ] Предупреждение 18+ на сайте
[ ] Политика cookie
[ ] Лицензия (после получения — разместить на сайте)
```

---

## 16. PostgreSQL Tuning

Базовая настройка PostgreSQL под сервер с 8-16 GB RAM:

```sql
-- /etc/postgresql/16/main/postgresql.conf

-- Memory
shared_buffers = 2GB              -- 25% от RAM
effective_cache_size = 6GB        -- 75% от RAM
work_mem = 16MB                   -- для сортировок
maintenance_work_mem = 256MB      -- для VACUUM, CREATE INDEX

-- Write performance
wal_buffers = 16MB
checkpoint_completion_target = 0.9
wal_compression = on

-- Query planning
random_page_cost = 1.1            -- для SSD
effective_io_concurrency = 200    -- для SSD

-- Connections
max_connections = 100
```

---

## 17. Disaster Recovery

### 17.1. Сценарии и действия

#### Сценарий 1: API недоступен

```
1. Проверить docker ps — контейнер запущен?
2. Если не запущен: docker compose -f docker-compose.prod.yml up -d api
3. Проверить логи: docker logs casino-api-1 --tail=100
4. Если ошибка БД — проверить postgres контейнер
5. Если нужен rollback: bash infra/scripts/rollback.sh
```

#### Сценарий 2: База данных повреждена

```
1. Остановить все контейнеры кроме postgres
2. Оценить повреждение: проверить логи postgres
3. Если можно восстановить — pg_dump + pg_restore
4. Если нет — восстановить из последнего бэкапа:
   bash infra/scripts/restore.sh backup_file.sql.gz
5. Запустить контейнеры
```

#### Сценарий 3: Диск заполнен

```
1. df -h — найти что занимает место
2. Обычно: docker images + logs
3. docker system prune -af — очистить неиспользуемые образы
4. Очистить старые логи
5. Увеличить диск через панель VPS провайдера
```

#### Сценарий 4: Взлом или компрометация

```
1. Немедленно снять сервер с публичного доступа (ufw deny 80, 443)
2. Сделать snapshot VPS
3. Сменить все пароли и API keys
4. Проверить audit logs на подозрительные действия
5. Заменить JWT secrets (все сессии инвалидируются)
6. Уведомить пользователей
7. Восстановить доступ после устранения проблемы
```

---

## 18. Итоговая структура всего ТЗ

После завершения всех 7 частей у тебя есть полное ТЗ:

```
Часть 1: Foundation — monorepo, стек, архитектура
Часть 2: Auth, Users, KYC, RBAC
Часть 3: Wallet, Payments (Rukassa + NOWPayments)
Часть 4: Casino Providers, Game Sessions, Seamless Wallet API
Часть 5: Frontend Web — каталог, игры, кошелёк, профиль
Часть 6: Admin Panel, Support, Referral System
Часть 7: DevOps, Security, Logging, QA, Release
```

### 18.1. Порядок разработки

Рекомендуемая последовательность для AI-агента:

```
Неделя 1-2:
  └── Часть 1: monorepo, БД, shared packages, Docker dev

Неделя 2-3:
  └── Часть 2: Auth (email, Google, Telegram), Users, KYC backend

Неделя 3-4:
  └── Часть 3: Wallet core, Rukassa, NOWPayments

Неделя 4-5:
  └── Часть 4: Casino providers, Seamless Wallet API, Demo provider

Неделя 5-7:
  └── Часть 5: Frontend Web полностью

Неделя 7-9:
  └── Часть 6: Admin Panel, Support, Referrals, Notifications

Неделя 9-10:
  └── Часть 7: DevOps настройка, деплой, тестирование
```

### 18.2. Что AI-агент получает для старта

Дать агенту в начале каждой задачи:

1. Содержимое `docs/ARCHITECTURE.md` — общий контекст;
2. Содержимое `docs/CONVENTIONS.md` — правила кодирования;
3. Содержимое `docs/AI_DEVELOPMENT_RULES.md` — специфичные правила;
4. Соответствующую часть ТЗ;
5. Актуальную Prisma schema.

---

## 19. AI_DEVELOPMENT_RULES.md

Финальный документ который ты даёшь AI-агенту в начале каждой сессии:

```markdown
# Правила разработки для AI-агента

## Контекст проекта
Online Casino Platform — СНГ рынок, русский язык.
Стек: NestJS + TypeScript + Prisma + PostgreSQL + Redis + Next.js

## Критические правила

### 1. Деньги
НИКОГДА не использовать number/float для денег.
ВСЕГДА string в API, ВСЕГДА decimal.js в коде, ВСЕГДА DECIMAL(20,8) в БД.

### 2. Idempotency
КАЖДАЯ финансовая операция ДОЛЖНА иметь idempotency_key.
Проверяй дубликаты ДО выполнения операции.

### 3. Структура модуля
Каждый модуль: domain/ → application/ → infrastructure/ → presentation/
Бизнес-логика ТОЛЬКО в application/use-cases/.
HTTP логика ТОЛЬКО в presentation/controllers/.
DB логика ТОЛЬКО в infrastructure/repositories/.

### 4. Ответы API
ВСЕГДА использовать:
  successResponse(data)
  successResponse(data, meta)
  errorResponse(code, message)
Никогда не возвращать сырые объекты.

### 5. Ошибки
ВСЕГДА создавать кастомные ошибки расширяющие AppError.
НИКОГДА не делать res.json({ error: '...' }) в controller.

### 6. Безопасность
НИКОГДА не логировать: пароли, токены, API keys, карты, документы.
ВСЕГДА валидировать входные данные через Zod.
ВСЕГДА проверять права доступа в Guard, не в Service.

### 7. Транзакции БД
Все финансовые операции — в prisma.$transaction().
При version conflict — retry до 3 раз с backoff.

### 8. Webhook обработка
ВСЕГДА сохранять raw callback в БД ДО обработки.
ВСЕГДА возвращать 200 OK провайдеру даже при ошибке.
НИКОГДА не зачислять средства без валидной подписи.

### 9. Перед созданием нового модуля
1. Прочитай docs/MODULE_BOUNDARIES.md
2. Проверь packages/shared-types/ на существующие типы
3. Проверь events/events.ts на существующие события
4. Следуй точной структуре модуля

### 10. Тесты
Каждый Service должен иметь unit тесты.
Mock repository в service tests, не реальную БД.
Для integration тестов — отдельная тестовая БД.
```

---

> **🎉 ТЗ полностью завершено.**
>
> Все 7 частей покрывают проект от архитектуры до деплоя.
> Теперь можно передавать AI-агенту по одной части и последовательно строить платформу.
