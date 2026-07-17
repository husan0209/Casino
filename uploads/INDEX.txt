---
title: Documentation Index
description: Навигация по всей документации casino-platform
status: living document
last_updated: 2026-06-19
---

# Documentation Index

> **Назначение:** Карта всей документации с навигацией. Этот файл — **точка входа** для AI-агента и разработчика.

---

## 1. Главные документы

### Обязательно прочитать при старте сессии

| Документ | Зачем | Обязательность |
|----------|-------|----------------|
| [README.md](../README.md) | Общая картина проекта | 📌 Обязательно |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Архитектурные решения | 📌 Обязательно |
| [STACK.md](./STACK.md) | Технологии и обоснование | 📌 Обязательно |
| [API_CONVENTIONS.md](./API_CONVENTIONS.md) | REST API standards | 📌 Обязательно |
| [CONVENTIONS.md](./CONVENTIONS.md) | Code conventions | 📌 Обязательно |
| [AI_DEVELOPMENT_RULES.md](./AI_DEVELOPMENT_RULES.md) | Правила AI-агента | 🚨 КРИТИЧНО |

### Для AI IDE / Agent (machine-readable правила)

| Документ | Зачем |
|----------|-------|
| [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) | Шаблоны `.cursorrules` / `CLAUDE.md` для Cursor, Windsurf, Cline, Claude Code |
| [MODULE_TEMPLATE.md](./MODULE_TEMPLATE.md) | Пошаговый чеклист создания нового backend модуля |

### Перед конкретными задачами

| Если работаешь с… | Дополнительно прочитай |
|--------------------|------------------------|
| **Новый модуль** | [MODULE_BOUNDARIES.md](./MODULE_BOUNDARIES.md) + [MODULE_TEMPLATE.md](./MODULE_TEMPLATE.md) |
| **Настройкой AI IDE** | [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) |
| **Payments / wallet** | [PAYMENT_OVERVIEW.md](./PAYMENT_OVERVIEW.md) |
| **Security / auth** | [SECURITY_BASELINE.md](./SECURITY_BASELINE.md) |
| **Casino providers** | [PROVIDER_INTEGRATION_STRATEGY.md](./PROVIDER_INTEGRATION_STRATEGY.md) |
| **Env-переменные** | [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) |

---

## 2. Техническое задание (7 частей)

| # | Часть | Документ | Описание |
|---|-------|----------|----------|
| 1 | Foundation | [tz-part-1-foundation.md](../tz-part-1-foundation.md) | Monorepo, стек, architecture, conventions |
| 2 | Backend Core | [tz-part-2-auth-users-kyc-rbac.md](../tz-part-2-auth-users-kyc-rbac.md) | Auth, Users, KYC, RBAC |
| 3 | Wallet & Payments | [tz-part-3-payments-wallet.md](../tz-part-3-payments-wallet.md) | Wallet ledger, Rukassa, NOWPayments |
| 4 | Casino Providers | [tz-part-4-casino-providers.md](../tz-part-4-casino-providers.md) | Seamless Wallet, providers, Demo |
| 5 | Frontend Web | [tz-part-5-frontend-web.md](../tz-part-5-frontend-web.md) | Next.js frontend |
| 6 | Admin & Support | [tz-part-6-admin-support-referrals.md](../tz-part-6-admin-support-referrals.md) | Admin panel, support, referrals |
| 7 | DevOps | [tz-part-7-devops-security-qa.md](../tz-part-7-devops-security-qa.md) | VPS, Docker, CI/CD, security, QA |

---

## 3. Карта документации по темам

### Архитектура и стек

- [README.md](../README.md) — high-level обзор
- [ARCHITECTURE.md](./ARCHITECTURE.md) — модульный монолит, слои
- [STACK.md](./STACK.md) — почему NestJS, Prisma, etc.
- [CONVENTIONS.md](./CONVENTIONS.md) — naming, структура файлов, TS rules
- [MODULE_BOUNDARIES.md](./MODULE_BOUNDARIES.md) — что делает каждый модуль

### API и контракты

- [API_CONVENTIONS.md](./API_CONVENTIONS.md) — REST API standards
- [PAYMENT_OVERVIEW.md](./PAYMENT_OVERVIEW.md) — payment providers
- [PROVIDER_INTEGRATION_STRATEGY.md](./PROVIDER_INTEGRATION_STRATEGY.md) — game providers

### Безопасность

- [SECURITY_BASELINE.md](./SECURITY_BASELINE.md) — security rules
- [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) — env vars и secrets

### Процессы

- [AI_DEVELOPMENT_RULES.md](./AI_DEVELOPMENT_RULES.md) — правила для AI-агента
- tz-part-7 — деплой, CI/CD, testing

---

## 4. Что где искать

### «Хочу понять общую архитектуру»
→ [README.md](../README.md) → [ARCHITECTURE.md](./ARCHITECTURE.md)

### «Хочу создать новый endpoint»
→ [API_CONVENTIONS.md](./API_CONVENTIONS.md) → [CONVENTIONS.md](./CONVENTIONS.md) → [MODULE_BOUNDARIES.md](./MODULE_BOUNDARIES.md)

### «Хочу понять как работают деньги»
→ [PAYMENT_OVERVIEW.md](./PAYMENT_OVERVIEW.md) + [CONVENTIONS.md](./CONVENTIONS.md) (раздел 5)

### «Хочу добавить новый платёжный провайдер»
→ [PAYMENT_OVERVIEW.md](./PAYMENT_OVERVIEW.md) → раздел 10 «Добавление нового провайдера»

### «Хочу добавить новый game-провайдер»
→ [PROVIDER_INTEGRATION_STRATEGY.md](./PROVIDER_INTEGRATION_STRATEGY.md) → раздел 9

### «Хочу настроить окружение»
→ [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)

### «Хочу понять настройки безопасности»
→ [SECURITY_BASELINE.md](./SECURITY_BASELINE.md)

### «Пишу код — какие правила соблюдать?»
→ [AI_DEVELOPMENT_RULES.md](./AI_DEVELOPMENT_RULES.md) — обязательно к прочтению

### «Я использую Cursor/Claude Code — как дать инструкции агенту?»
→ [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) — готовые `.cursorrules` / `CLAUDE.md` шаблоны

### «Хочу создать новый backend модуль с нуля»
→ [MODULE_TEMPLATE.md](./MODULE_TEMPLATE.md) — 10 шагов от README до PR-чеклиста

---

## 5. Конвенция по размещению

```
/                                 repo root
├── README.md                     ← high-level overview
├── tz-part-1 ... tz-part-7.md    ← 7 частей ТЗ
├── docs/
│   ├── INDEX.md                  ← этот файл
│   ├── ARCHITECTURE.md
│   ├── STACK.md
│   ├── CONVENTIONS.md
│   ├── API_CONVENTIONS.md
│   ├── MODULE_BOUNDARIES.md
│   ├── MODULE_TEMPLATE.md
│   ├── SECURITY_BASELINE.md
│   ├── PAYMENT_OVERVIEW.md
│   ├── PROVIDER_INTEGRATION_STRATEGY.md
│   ├── ENVIRONMENT_VARIABLES.md
│   ├── AGENT_INSTRUCTIONS.md     ← .cursorrules / CLAUDE.md шаблоны
│   └── AI_DEVELOPMENT_RULES.md
├── apps/                         ← npm workspace apps
│   ├── api/
│   ├── web/
│   └── admin/
├── packages/                     ← shared packages
│   ├── database/                 ← Prisma schema
│   ├── shared-types/
│   ├── shared-utils/
│   └── shared-config/
└── infra/                        ← deployment configs
    ├── docker/
    └── scripts/
```

---

## 6. Поддержка актуальности

Документы обновляются **синхронно с TZ**. Если вы обновляете TZ-часть, проверьте что затронутые docs также обновлены.

При появлении противоречий между TZ и docs — **документация приоритетнее** для AI-агента (TZ может содержать устаревшие примеры кода).

---

> **Последнее обновление:** 2026-06-19
> **Версия ТЗ:** v1.0 (7 частей + README)
> **Документов создано:** 13 (этот INDEX + 11 тематических: ARCHITECTURE, STACK, CONVENTIONS, API_CONVENTIONS, MODULE_BOUNDARIES, MODULE_TEMPLATE, SECURITY_BASELINE, PAYMENT_OVERVIEW, PROVIDER_INTEGRATION_STRATEGY, ENVIRONMENT_VARIABLES, AGENT_INSTRUCTIONS + AI_DEVELOPMENT_RULES)
