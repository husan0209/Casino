---
title: Stack
description: Обоснование выбора технологического стека casino-platform
status: living document
last_updated: 2026-06-19
---

# Stack

> **Назначение:** Объяснить **почему** выбран каждый инструмент, чтобы AI-агент не заменял его на аналог «потому что популярнее».

---

## Backend

### Runtime: Node.js 20 LTS

| Фактор | Решение |
|--------|---------|
| Универсальность | Подходит для API, workers, scripts |
| Экосистема | Зрелые библиотеки для payment SDK |
| LTS-поддержка | Активная до апреля 2026 |
| AI-friendly | Огромная база знаний в LLM-тренинге |

**Не выбрано:**

- Bun — слишком молодой, проблемы с Prisma binaries
- Deno — малый ecosystem для корпоративных SDK
- Go — отличный, но менее выразительный для AI-генерации
- Python — медленнее для high-frequency use cases

### Framework: NestJS 11

**Почему NestJS:**

| Причина | Значение |
|---------|----------|
| **Модульная архитектура из коробки** | DI-контейнер, модули, middleware |
| **Предсказуемая структура** | AI-агент знает где что писать |
| **Best practices по умолчанию** | Если следуешь NestJS — следуешь best practice |
| **TypeScript first** | Нет «или JS» вариантов |
| **Guards, interceptors, pipes** | Cross-cutting concerns решены |
| **Огромный ecosystem** | jwt, throttler, swagger, bull, passport |
| **Чёткий путь миграции** | Express → NestJS = простой переход |

**Не выбрано:**

- Express — нет структуры, всё развалится к 30-му модулю
- Fastify — быстрее, но хуже ecosystem
- Hono — для edge, не для монолита
- tRPC — не REST-first, плохо для public API

### ORM: Prisma 5

**Почему Prisma:**

| Причина | Значение |
|---------|----------|
| **Type-safety** | Generated types → меньше багов |
| **Migration story** | `./prisma migrate deploy` production-ready |
| **PostgreSQL-native** | Полная поддержка DECIMAL, JSONB, ENUM |
| **Документация** | Prisma docs = известный набор знаний |
| **Connection pooling** | Поддержка PgBouncer |
| **Schema as code** | Versioned, reviewable schema |

**Не выбрано:**

- TypeORM — слабая type-safety, утечки connections
- Drizzle — молодой, меньше примеров в LLM
- Sequelize — ORM без compile-time типов
- raw SQL — слишком много boilerplate

### Database: PostgreSQL 16

**Почему PostgreSQL:**

- ACID транзакции → критично для денег
- `DECIMAL` тип → точные расчёты без float
- `JSONB` → гибкость для metadata
- `pg_stat_statements` → мониторинг запросов
- Зрелый, проверенный годами

**Версия:** 16 (актуальный LTS-выбор, materialized views, MERGE)

### Cache & Queues: Redis 7 + BullMQ

| Use case | Где |
|----------|-----|
| Rate limit counters | Redis |
| Session cache | Redis |
| Idempotency dedup | Redis SET NX |
| BullMQ backend | Redis |
| Game launch temp tokens | Redis (TTL 60s) |
| Realtime bans | Redis |

**Почему Redis 7:**

- RedisJSON / Streams не нужны → простой key-value
- TLS / ACL из коробки
- Малый footprint (50MB RAM)

**Почему BullMQ:**

- TypeScript-first, type-safe jobs
- UI через Bull Board (опционально)
- Retry/backoff built-in
- Rate limit на стороне queue (опционально)
- Достаточно для MVP, не нужен RabbitMQ

**Не выбрано:**

- RabbitMQ — overkill для одного worker pool
- Kafka — только если 100k+ events/sec
- AWS SQS — нет AWS lock-in

### Validation: Zod

**Почему Zod:**

- TypeScript-first (типы из схемы)
- Композиция схем
- Хорошая поддержка в NestJS через `nestjs-zod`
- Используется и в frontend (React Hook Form)

**Не выбрано:**

- class-validator — нужны декораторы, типы отдельно
- Joi — не TypeScript
- yup — медленнее, менее типобезопасно

### Password: argon2id

**Почему argon2id:**

- Современный стандарт (RFC 9106)
- Параметры: `memoryCost=65536, timeCost=3, parallelism=4`
- Устойчив к GPU-атакам (memory-hard)

**Не выбрано:**

- bcrypt — не memory-hard, GPU-атаки реальны
- scrypt — менее стандартизирован
- PBKDF2 — медленнее при эквивалентной защите

### JWT: HS256 (MVP) / RS256 (scale)

**MVP:** HMAC SHA-256 с длинным секретом (≥64 chars)
**При росте:** RSA-ключи (public/private) для distributed verification

### Process Manager: Docker + Docker Compose

**Почему Docker:**

- Identical environments от dev до prod
- Built-in restart policy
- Health checks из коробки
- Легко мигрировать на Kubernetes если нужно

**Почему НЕ PM2:**

- Требует ручной настройки логирования
- Нет rollback
- Нет auto-restart с конфигом
- Дополнительный слой между Docker и OS

---

## Frontend (Web)

### Framework: Next.js 14+ (App Router)

**Почему Next.js:**

| Причина | Значение |
|---------|----------|
| **App Router + RSC** | SSR/SSG/ISR из коробки |
| **TypeScript native** | Полная типизация |
| **Image optimization** | next/image для thumbnails |
| **Vercel-ready** | Можно перенести на Vercel для HA |
| **SEO** | Server-side rendering для главной |
| **Routing** | file-based = AI-friendly |
| **Code splitting** | Автоматическое |

**Режимы:**

- **Главная + каталог** — ISR с revalidate 60-300s
- **Game page** — SSR (динамические данные)
- **Profile / wallet** — CSR (auth-only)

### Styling: Tailwind CSS

**Почему Tailwind:**

- Atomic CSS → меньше размер CSS
- Консистентность через design tokens
- AI-агент хорошо предсказывает utility classes
- Tree-shaking из коробки

**Не выбрано:**

- CSS-in-JS (styled-components) — runtime overhead, медленнее
- CSS modules — больше boilerplate
- Mantine/Chakra — слишком opinionated, плохо для casino-дизайна

### Server State: TanStack Query

**Почему TanStack Query:**

- Cache invalidation / refetch / prefetch — всё built-in
- Optimistic updates (для избранного, ставок)
- TypeScript-safe queries
- React-friendly компонентная модель

### Client State: Zustand

**Почему Zustand:**

- Lightweight (1.2 KB)
- No provider hell
- Hooks-based API
- Persistence middleware (localStorage)

**Не выбрано:**

- Redux — слишком много boilerplate
- Context API — производительность
- Jotai — overkill для простого state

### Forms: React Hook Form + Zod

- RHF — минимум re-renders
- Zod — shared schemas с backend

### HTTP Client: Axios

**Почему Axios:**

- Interceptors (для auto-refresh токена)
- Request cancellation
- Timeouts (для webhook polling)
- Stable, mature

Fetch API не подходит из-за сложности с interceptors.

---

## Admin Panel

### Стек: Next.js + shadcn/ui

**Почему shadcn/ui:**

- Не библиотека, а набор copy-paste компонентов
- Tailwind + Radix UI под капотом
- Полная кастомизация под casino-дизайн
- Tables: TanStack Table (sorting, filtering, pagination)

**Решения:**

- Графики — Recharts (small footprint, declarative)
- Даты — date-fns (tree-shakeable)
- Drag-drop — не нужно
- Виртуализация таблиц — TanStack Virtual

---

## DevOps

### Container: Docker

### Orchestration: Docker Compose (MVP), возможно k3s/Swarm позже

### Reverse Proxy: Nginx

**Почему Nginx:**

- battle-tested, минимум CPU/RAM
- SSL termination
- Rate limiting zones
- WebSocket-ready (если понадобится)
- Logs в JSON-формате

**Не выбрано:**

- Traefik — Docker-native, но тяжелее
- Caddy — отличный, но меньше примеров конфигов
- HAProxy — overkill для одного бэкенда

### SSL: Let's Encrypt (certbot)

Бесплатные auto-renew сертификаты. Wildcard через DNS challenge.

### Monitoring: UptimeRobot + log monitoring

**MVP не требует:**

- Prometheus + Grafana (overkill)
- Elasticsearch + Kibana (overkill)
- Datadog / NewRelic ($$$)

### CI/CD: GitHub Actions

- Бесплатно для open source
- Postgres + Redis service containers для тестов
- SSH action для деплоя на VPS

---

## Почему НЕ эти технологии

| Технология | Почему нет |
|------------|-----------|
| Microservices | На MVP — overkill |
| GraphQL | REST проще для публичного API + webhook'и |
| MongoDB | Нет ACID, денормализация рискованна для денег |
| Kafka | До 10k events/sec достаточно Redis/BullMQ |
| Kubernetes | На 1 VPS — избыточно |
| Vercel | Не для backend (web только) |
| AWS lock-in | VPS = freedom миграции |
| TypeORM | Слабее Prisma по типам |
| Mongoose | Не используется (нет MongoDB) |
| Spring Boot | Java overhead, медленная AI-разработка |
| Django | Python ≠ TypeScript между frontend/backend |

---

## Версионирование

Все версии фиксируются в `pnpm-lock.yaml`. Любое обновление major-версии требует:
1. Прочитать migration guide
2. Протестировать в dev
3. Сначала обновить в shared packages
4. Затем в приложениях

**Major-версии трогать ТОЛЬКО в начале новой фазы.**

---

> **Принцип:** предсказуемость важнее новизны. Использовать проверенный mainstream стек, на котором AI-агент даёт наилучшие результаты.
