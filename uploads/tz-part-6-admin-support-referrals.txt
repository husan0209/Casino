---
title: "ТЗ — Casino Platform"
subtitle: "Часть 6. Admin Panel, Support, Referral System, Notifications"
version: 1.0
date: 2026-06-19
part: 6 / 7
progress: ✅ Part 6 saved
---

# ТЗ — Casino Platform

> **Оглавление серии ТЗ:**
> 1. ✅ [Часть 1. Общая архитектура и Foundation](./tz-part-1-foundation.md)
> 2. ✅ [Часть 2. Backend Core: Auth, Users, KYC, RBAC](./tz-part-2-auth-users-kyc-rbac.md)
> 3. ✅ [Часть 3. Wallet, Fiat/Crypto Payments, Transaction Ledger](./tz-part-3-payments-wallet.md)
> 4. ✅ [Часть 4. Casino Providers и Game Session Layer](./tz-part-4-casino-providers.md)
> 5. ✅ [Часть 5. Frontend Web — витрина, ЛК, кошелёк, история](./tz-part-5-frontend-web.md)
> 6. ✅ **Часть 6. Admin Panel, Support, Referral System, Notifications** _(вы тут)_
> 7. ⏳ Часть 7. DevOps, Security, Logging, QA, Release Prep

---

## Содержание части 6

- [1. Цель этапа](#1-цель-этапа)
- [2. Admin Panel — Общие принципы](#2-admin-panel--общие-принципы)
- [3. Admin Layout](#3-admin-layout)
- [4. Дашборд](#4-дашборд)
- [5. Управление пользователями](#5-управление-пользователями)
- [6. Финансовый раздел админки](#6-финансовый-раздел-админки)
- [7. KYC Раздел админки](#7-kyc-раздел-админки)
- [8. Казино раздел админки](#8-казино-раздел-админки)
- [9. Система поддержки — Backend](#9-система-поддержки--backend)
- [10. Реферальная система — Backend](#10-реферальная-система--backend)
- [11. Система уведомлений — Backend](#11-система-уведомлений--backend)
- [12. Управление администраторами](#12-управление-администраторами)
- [13. Глобальные настройки](#13-глобальные-настройки)
- [14. Audit Logs в админке](#14-audit-logs-в-админке)
- [15. Шаблоны Email](#15-шаблоны-email)
- [16. Admin Panel Frontend — Технические задачи](#16-admin-panel-frontend--технические-задачи-части-6)
- [17. Что НЕ делать в Части 6](#17-что-не-делать-в-части-6)

---

# 1. Цель этапа

Эта часть описывает полную реализацию:

- панели администратора;
- системы тикетов поддержки;
- реферальной системы;
- уведомлений.

После этого этапа платформа будет иметь все инструменты для операционного управления казино.

---

# 2. Admin Panel — Общие принципы

## 2.1. Технический стек

```text
Next.js 14+         — App Router
TypeScript
Tailwind CSS
shadcn/ui            — компонентный набор для админки
TanStack Query       — server state
TanStack Table       — таблицы с сортировкой, фильтрацией, пагинацией
Zustand              — client state
React Hook Form + Zod — формы и валидация
Recharts             — графики на дашборде
date-fns             — работа с датами
```

## 2.2. Дизайн-концепция

- тёмная тема;
- чистый и функциональный layout;
- акцент на плотность информации;
- быстрая навигация;
- много таблиц с фильтрами;
- минимальная декоративность.

## 2.3. Аутентификация

Админка использует отдельный auth flow:

- отдельный endpoint `/api/v1/admin/auth/login`;
- отдельный JWT с ролью admin / superadmin;
- не использует пользовательские cookies / сессии;
- при логине проверяется `admin_users` таблица;
- при невалидном токене — редирект на страницу логина админки.

## 2.4. Общая структура приложения

```text
apps/admin/
  src/
    app/
      login/
        page.tsx
      (dashboard)/
        page.tsx                   — главный дашборд
        users/
          page.tsx                 — список пользователей
          [id]/
            page.tsx               — карточка пользователя
        transactions/
          page.tsx                 — все транзакции
        payments/
          page.tsx                 — платёжные запросы
          [id]/
            page.tsx               — детали платежа
        withdrawals/
          page.tsx                 — заявки на вывод
        kyc/
          page.tsx                 — заявки KYC
          [id]/
            page.tsx               — детали KYC
        games/
          page.tsx                 — каталог игр
        providers/
          page.tsx                 — список провайдеров
          [id]/
            page.tsx               — настройки провайдера
        support/
          page.tsx                 — тикеты поддержки
          [id]/
            page.tsx               — конкретный тикет
        referrals/
          page.tsx                 — реферальная система
        audit/
          page.tsx                 — audit logs
        admins/
          page.tsx                 — управление администраторами
        settings/
          page.tsx                 — глобальные настройки
    components/
      layout/
      ui/
      shared/
      tables/
      charts/
      modals/
    hooks/
    stores/
    lib/
```

---

# 3. Admin Layout

## 3.1. Структура

```text
┌──────────────────────────────────────────────────┐
│  HEADER: Logo  |  Поиск  |  Уведомления  | Admin│
├────────────┬─────────────────────────────────────┤
│            │                                     │
│  SIDEBAR   │          MAIN CONTENT               │
│  (fixed)   │                                     │
│            │                                     │
│            │                                     │
│            │                                     │
│            │                                     │
└────────────┴─────────────────────────────────────┘
```

## 3.2. Sidebar

```text
📊 Дашборд

👥 Пользователи
  └ Список пользователей
  └ KYC заявки

💰 Финансы
  └ Транзакции
  └ Платёжные запросы
  └ Заявки на вывод

🎮 Казино
  └ Игры
  └ Провайдеры
  └ Игровые сессии

🎫 Поддержка
  └ Тикеты

👥 Рефералы
  └ Рефералы

📋 Аудит
  └ Журнал действий

⚙️ Настройки
  └ Администраторы        (superadmin only)
  └ Глобальные настройки  (superadmin only)
```

## 3.3. Header

- логотип "Admin Panel";
- глобальный поиск (поиск по пользователям, транзакциям, тикетам);
- иконка уведомлений с badge (количество pending withdrawals + pending KYC);
- dropdown с профилем администратора и кнопкой "Выйти".

---

# 4. Дашборд

**Маршрут:** `/` (главная админки)

## 4.1. Карточки метрик (верхняя часть)

```text
┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ ПОЛЬЗОВАТЕЛИ   │ │   ДЕПОЗИТЫ     │ │    ВЫВОДЫ      │ │     GGR        │
│                │ │                │ │                │ │                │
│    12,450      │ │   125,000 ₽    │ │   45,000 ₽     │ │   80,000 ₽     │
│  +150 сегодня  │ │  +23,000 сег.  │ │  +12,000 сег.  │ │  +18,000 сег.  │
└────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘
```

**Метрики:**

- Всего пользователей / новых за сегодня;
- Сумма депозитов за сегодня;
- Сумма выводов за сегодня;
- GGR за сегодня (Gross Gaming Revenue = ставки − выигрыши);
- NGR за сегодня (Net Gaming Revenue = GGR − бонусы, на MVP равно GGR);
- Активные игроки за сегодня (сделали хотя бы одну ставку).

## 4.2. Графики

### График 1: Доход за период

Линейный график:
- ось X: дни (последние 30 дней);
- ось Y: сумма в RUB;
- линии: депозиты, выводы, GGR;
- переключатель периода: 7 дней, 30 дней, 90 дней.

### График 2: Регистрации

Столбчатый график:
- ось X: дни;
- ось Y: количество;
- переключатель периода.

## 4.3. Quick Actions

```text
[ Ожидают вывода: 5 ]  ← кликабельно, ведёт на /withdrawals?status=pending
[ KYC на проверке: 3 ] ← кликабельно, ведёт на /kyc?status=pending
[ Открытых тикетов: 8 ] ← кликабельно, ведёт на /support?status=open
```

## 4.4. Последние события

Таблица с последними 10 событиями:

```text
Время | Событие | Детали
15:30 | Новый депозит   | User#123 пополнил 5 000 ₽
15:28 | KYC заявка      | User#456 подал документы
15:25 | Крупный выигрыш | User#789 выиграл 50 000 ₽ в Sweet Bonanza
15:20 | Вывод           | User#101 запросил вывод 10 000 ₽
```

## 4.5. API для дашборда

### UC-ADMIN-DASH-01: Получить метрики

```http
GET /api/v1/admin/dashboard/metrics
```

**Параметры:** period (today, 7d, 30d, 90d)

**Ответ:**

```json
{
  "success": true,
  "data": {
    "users": {
      "total": 12450,
      "new_today": 150,
      "active_today": 320
    },
    "finance": {
      "deposits_today": "125000.00",
      "withdrawals_today": "45000.00",
      "ggr_today": "80000.00",
      "deposits_total": "5000000.00",
      "withdrawals_total": "2000000.00"
    },
    "pending": {
      "withdrawals": 5,
      "kyc": 3,
      "tickets": 8
    }
  }
}
```

### UC-ADMIN-DASH-02: Получить данные графиков

```http
GET /api/v1/admin/dashboard/charts
```

**Параметры:** period, type (revenue, registrations)

**Ответ:**

```json
{
  "success": true,
  "data": {
    "labels": ["2024-01-01", "2024-01-02", "..."],
    "datasets": {
      "deposits": [12000, 15000, "..."],
      "withdrawals": [5000, 8000, "..."],
      "ggr": [7000, 7000, "..."]
    }
  }
}
```

### UC-ADMIN-DASH-03: Получить последние события

```http
GET /api/v1/admin/dashboard/events
```

**Параметры:** limit (default 10)

Агрегирует последние записи из:

- `payment_requests` (новые депозиты/выводы);
- `kyc_profiles` (новые заявки);
- `game_transactions` (крупные выигрыши > порога);
- `users` (новые регистрации);
- `support_tickets` (новые тикеты).

---

# 5. Управление пользователями

## 5.1. Список пользователей

**Маршрут:** `/users`

### UC-ADMIN-USER-01: Список пользователей

```http
GET /api/v1/admin/users
```

**Параметры:**

```text
page, per_page
search          — поиск по email, username, id
status          — active, blocked, suspended
kyc_status      — not_started, pending, approved, rejected
has_balance     — true / false (есть ненулевой баланс)
registered_from — дата начала
registered_to   — дата конца
sort            — created_at, last_login_at, balance
order           — asc, desc
```

**Таблица:**

```text
ID | Email | Статус | KYC | Баланс (RUB экв.) | Депозиты | Выводы | GGR | Дата рег. | Послед. вход | Действия
```

**Действия в строке:**

- 👁️ Просмотр — переход на карточку;
- 🔒 Заблокировать / 🔓 Разблокировать.

## 5.2. Карточка пользователя

**Маршрут:** `/users/[id]`

### UC-ADMIN-USER-02: Детали пользователя

```http
GET /api/v1/admin/users/:id
```

**Структура страницы:**

```text
[ ШАПКА ]
  Аватар | Email | Статус | KYC статус | Реф. код | Дата регистрации
  Кнопки: [Заблокировать] [Разблокировать]

[ ВКЛАДКИ ]
  Обзор | Кошелёк | Транзакции | Игровая активность | KYC | Рефералы | Тикеты | Аудит

[ ТАБ: Обзор ]
  Личные данные:
    Имя, фамилия, дата рождения, страна, телефон

  Auth providers:
    email, google, telegram — какие привязаны

  Статистика:
    Всего депозитов: 50 000 ₽
    Всего выводов:  20 000 ₽
    GGR:           30 000 ₽
    Всего ставок: 200 000 ₽
    Всего выигрышей: 170 000 ₽
    Реферер: User#555 (если пришёл по реферальной ссылке)

[ ТАБ: Кошелёк ]
  Таблица балансов по валютам
  Кнопки: [Зачислить вручную] [Списать вручную]

[ ТАБ: Транзакции ]
  Таблица ledger_entries пользователя с фильтрами

[ ТАБ: Игровая активность ]
  Таблица game_sessions пользователя
  Клик на сессию → детали с раундами

[ ТАБ: KYC ]
  Текущий статус
  Данные заявки
  Загруженные документы (просмотр)
  Кнопки: [Одобрить] [Отклонить] [Запросить повторно]

[ ТАБ: Рефералы ]
  Список рефералов пользователя
  Реферальные начисления

[ ТАБ: Тикеты ]
  Тикеты поддержки пользователя

[ ТАБ: Аудит ]
  Действия связанные с пользователем из audit_logs
```

## 5.3. Ручная корректировка баланса

### UC-ADMIN-USER-03: Зачислить средства

При нажатии кнопки "Зачислить вручную" открывается модалка:

```text
Зачисление средств для User#123

Валюта *
[ RUB ▼ ]

Сумма *
[ ____________ ]

Причина * (обязательно)
[ __________________________ ]

[Отмена] [Зачислить]
```

**Backend:** `POST /api/v1/admin/wallet/:user_id/credit`

Обязательная запись в `audit_log`.

### UC-ADMIN-USER-04: Списать средства

Аналогичная модалка с валидацией что баланс ≥ суммы списания.

**Backend:** `POST /api/v1/admin/wallet/:user_id/debit`

## 5.4. Блокировка пользователя

### UC-ADMIN-USER-05: Заблокировать

Модалка:

```text
Заблокировать пользователя?

Причина *
[ __________________________ ]

⚠️ Пользователь не сможет:
  • Входить в аккаунт
  • Играть
  • Пополнять и выводить средства

[Отмена] [Заблокировать]
```

**Backend:** `POST /api/v1/admin/users/:id/block`

**Алгоритм:**

```text
1. Обновить users.status = blocked
2. Инвалидировать все sessions пользователя
3. Записать в audit_log
4. Отправить уведомление пользователю (email)
```

### UC-ADMIN-USER-06: Разблокировать

**Backend:** `POST /api/v1/admin/users/:id/unblock`

```text
1. Обновить users.status = active
2. Записать в audit_log
3. Отправить уведомление
```

---

# 6. Финансовый раздел админки

## 6.1. Все транзакции

**Маршрут:** `/transactions`

### UC-ADMIN-FIN-01: Список транзакций

```http
GET /api/v1/admin/transactions
```

**Параметры:**

```text
page, per_page
user_id         — фильтр по пользователю
type            — DEPOSIT, WITHDRAWAL, BET, WIN, ROLLBACK,
                  ADMIN_CREDIT, ADMIN_DEBIT, REFERRAL_REWARD
currency
amount_min
amount_max
from, to
```

**Таблица:**

```text
ID | Дата | Пользователь | Тип | Сумма | Валюта | Баланс после | Описание
```

Сумма выделяется цветом:

- зелёный для зачислений;
- красный для списаний.

## 6.2. Платёжные запросы

**Маршрут:** `/payments`

### UC-ADMIN-FIN-02: Список платёжных запросов

```http
GET /api/v1/admin/payment-requests
```

**Параметры:**

```text
page, per_page
user_id
type            — deposit, withdrawal
status          — pending, processing, completed, failed, cancelled, expired
provider        — rukassa, nowpayments, manual
currency
from, to
```

**Таблица:**

```text
ID | Дата | Пользователь | Тип | Провайдер | Сумма | Валюта | Статус | External ID | Действия
```

### UC-ADMIN-FIN-03: Детали платёжного запроса

**Маршрут:** `/payments/[id]`

```http
GET /api/v1/admin/payment-requests/:id
```

**Страница:**

```text
[ ИНФОРМАЦИЯ О ПЛАТЕЖЕ ]
  ID: ...
  Тип: Депозит / Вывод
  Статус: Completed
  Провайдер: Rukassa
  Сумма: 5 000.00 RUB
  External ID: ...
  Создан: ...
  Завершён: ...

[ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ]
  Email | Статус | KYC

[ DESTINATION ] (для выводов)
  Карта: **** 1234 / Адрес: TXyz...

[ RAW CALLBACKS ]
  Таблица payment_callbacks:
    Дата | IP | Processed | Raw Body (expandable)

[ СВЯЗАННЫЕ ТРАНЗАКЦИИ ]
  ledger_entries связанные с этим платежом
```

## 6.3. Заявки на вывод

**Маршрут:** `/withdrawals`

### UC-ADMIN-FIN-04: Список заявок на вывод

```http
GET /api/v1/admin/withdrawals
```

**Параметры:** page, per_page, status, user_id, currency, from, to

**Таблица:**

```text
ID | Дата | Пользователь | Сумма | Валюта | Метод | Destination | KYC | Статус | Действия
```

**Действия:**

- ✅ Одобрить;
- ❌ Отклонить;
- 👁️ Подробнее.

### UC-ADMIN-FIN-05: Массовые действия

Чекбоксы на строках:

```text
[Выбрать все на странице]
Выбрано: 3
[✅ Одобрить выбранные] [❌ Отклонить выбранные]
```

При массовом одобрении / отклонении:

- модалка подтверждения: "Одобрить 3 заявки на общую сумму 15 000 ₽?";
- для отклонения — общая причина;
- backend обрабатывает каждую заявку отдельно;
- при ошибке одной — остальные всё равно обрабатываются;
- показать результат: "Одобрено: 2, Ошибок: 1".

**Backend:**

```http
POST /api/v1/admin/withdrawals/batch-approve
Body: { "ids": ["id1", "id2", "id3"] }

POST /api/v1/admin/withdrawals/batch-reject
Body: { "ids": ["id1", "id2"], "reason": "..." }
```

### UC-ADMIN-FIN-06: Одобрение вывода с деталями

При клике "Одобрить" на конкретной заявке:

```text
Одобрить вывод #123

Пользователь: user@example.com
Сумма: 10 000 ₽
Метод: На карту
Карта: **** **** **** 5678
Держатель: IVAN PETROV

KYC статус: ✅ Верифицирован

⚠️ Средства будут списаны с баланса пользователя.
   Убедитесь что перевод отправлен.

[Отмена] [Подтвердить одобрение]
```

---

# 7. KYC Раздел админки

**Маршрут:** `/kyc`

## 7.1. Список KYC заявок

### UC-ADMIN-KYC-01: Список заявок

```http
GET /api/v1/admin/kyc
```

**Параметры:** page, per_page, status, from, to

**Таблица:**

```text
ID | Пользователь | Имя | Страна | Тип документа | Статус | Подана | Действия
```

**Фильтры-вкладки вверху:**

```text
[ Все ] [ Ожидают (3) ] [ Одобрены ] [ Отклонены ] [ Повторная отправка ]
```

Badge с количеством pending заявок.

## 7.2. Детали KYC заявки

**Маршрут:** `/kyc/[id]`

### UC-ADMIN-KYC-02: Просмотр заявки

```http
GET /api/v1/admin/kyc/:id
```

**Страница:**

```text
[ СТАТУС ]
  Текущий статус: Ожидает проверки
  Подана: 01.01.2024 15:30

[ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ]
  ID | Email | Дата регистрации | Общая сумма депозитов

[ ПЕРСОНАЛЬНЫЕ ДАННЫЕ ]
  Имя: Иван
  Фамилия: Петров
  Дата рождения: 15.05.1990
  Страна: RU
  Тип документа: Паспорт
  Номер документа: 1234 567890
  Срок действия: 01.01.2030

[ ЗАГРУЖЕННЫЕ ДОКУМЕНТЫ ]
  Документ (лицевая сторона):
    [  Превью изображения — кликабельно для увеличения  ]

  Документ (обратная сторона):
    [  Превью  ]

  Селфи с документом:
    [  Превью  ]

[ ДЕЙСТВИЯ ]
  [✅ Одобрить]
  [❌ Отклонить]
  [🔄 Запросить повторную отправку]

[ ИСТОРИЯ СТАТУСОВ ]
  01.01.2024 15:30 — Подана пользователем
  01.01.2024 16:00 — Отклонена (причина: нечёткий документ)
  01.01.2024 17:00 — Повторная подача
```

### UC-ADMIN-KYC-03: Одобрение

При нажатии "Одобрить":

```text
Одобрить верификацию?

Пользователь: user@example.com
Документ: Паспорт

[Отмена] [Одобрить]
```

**Backend:** `POST /api/v1/admin/kyc/:id/approve`

### UC-ADMIN-KYC-04: Отклонение

```text
Отклонить верификацию

Причина *
[ ________________________________ ]

Пример причин:
  • Документ нечёткий
  • Данные не совпадают
  • Документ просрочен
  • Подозрение на подделку

[Отмена] [Отклонить]
```

**Backend:** `POST /api/v1/admin/kyc/:id/reject`

### UC-ADMIN-KYC-05: Запрос повторной отправки

```text
Запросить повторную отправку

Что нужно переделать? *
[ ________________________________ ]

[Отмена] [Отправить запрос]
```

**Backend:** `POST /api/v1/admin/kyc/:id/request-resubmission`

---

# 8. Казино раздел админки

## 8.1. Провайдеры

**Маршрут:** `/providers`

### UC-ADMIN-CASINO-01: Список провайдеров

```http
GET /api/v1/admin/providers
```

**Таблица:**

```text
Лого | Название | Slug | Тип | Кол-во игр | Статус (вкл/выкл) | Действия
```

**Действия:**

- 🔧 Настройки;
- ✅ Включить / ⛔ Выключить;
- 🔄 Синхронизировать игры.

### UC-ADMIN-CASINO-02: Настройки провайдера

**Маршрут:** `/providers/[id]`

```text
[ ОСНОВНЫЕ ДАННЫЕ ]
  Название
  Slug
  Тип
  API URL
  API Key     (показывать маскированным, с кнопкой "показать")
  API Secret  (аналогично)

[ КОНФИГУРАЦИЯ ]
  JSON Editor для config поля
  Или структурированная форма если поля известны

[ СТАТИСТИКА ]
  Всего игр: 250
  Активных игр: 230
  Сессий за сегодня: 150
  GGR за сегодня: 25 000 ₽

[ ДЕЙСТВИЯ ]
  [Сохранить]
  [Синхронизировать игры]
  [Включить / Выключить]
```

### UC-ADMIN-CASINO-03: Синхронизация игр

При нажатии "Синхронизировать":

```text
Синхронизация игр от Pragmatic Play...

Результат:
  Добавлено новых игр: 15
  Обновлено: 230
  Всего: 245

Новые игры добавлены как ВЫКЛЮЧЕННЫЕ.
Проверьте и включите нужные.

[Перейти к списку игр]
```

## 8.2. Игры

**Маршрут:** `/games`

### UC-ADMIN-CASINO-04: Список игр

```http
GET /api/v1/admin/games
```

**Параметры:** page, per_page, search, provider_id, category, is_enabled, is_featured, is_new, is_popular

**Таблица:**

```text
Thumbnail | Название | Провайдер | Категория | RTP | Запусков | Featured | Статус | Действия
```

**Действия:**

- ✅ Включить / ⛔ Выключить;
- ⭐ Featured / убрать;
- ✏️ Редактировать.

**Массовые действия:**

- включить выбранные;
- выключить выбранные;
- установить featured.

### UC-ADMIN-CASINO-05: Редактирование игры

Модалка или отдельная страница:

```text
Название (RU): [ Sweet Bonanza ]
Категория:    [ Слоты ▼ ]
Is New:     [ ✓ ]
Is Popular: [ ✓ ]
Is Featured:[ ✓ ]
Sort Order: [ 10 ]
Теги: [ bonus_buy, megaways ] (ввод через запятую или chips)
Thumbnail URL: [ ... ]

[Сохранить]
```

## 8.3. Игровые сессии

**Маршрут:** в рамках `/users/[id]` таб "Игровая активность" или отдельно `/game-sessions`.

### UC-ADMIN-CASINO-06: Список сессий

```http
GET /api/v1/admin/game-sessions
```

**Параметры:** page, per_page, user_id, game_id, provider_id, status, from, to

**Таблица:**

```text
ID | Пользователь | Игра | Провайдер | Валюта | Ставки | Выигрыши | GGR | Раундов | Статус | Начало
```

---

# 9. Система поддержки — Backend

## 9.1. Сущности базы данных

### Таблица `support_tickets`

```text
id              UUID, PK
user_id         UUID, FK -> users.id
subject         VARCHAR(255), not null
category        ENUM(payments, games, technical, account, other), not null
status          ENUM(open, in_progress, waiting_user, closed), default open
priority        ENUM(low, normal, high, urgent), default normal
assigned_to     UUID, nullable, FK -> admin_users.id
closed_at       TIMESTAMPTZ, nullable
closed_by       ENUM(user, admin), nullable
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ

INDEX(user_id)
INDEX(status)
INDEX(priority)
INDEX(assigned_to)
INDEX(created_at)
```

### Таблица `support_messages`

```text
id              UUID, PK
ticket_id       UUID, FK -> support_tickets.id
sender_type     ENUM(user, admin)
sender_id       UUID, not null
message         TEXT, not null
attachments     JSONB, default '[]'
is_internal     BOOLEAN, default false
created_at      TIMESTAMPTZ

INDEX(ticket_id)
INDEX(created_at)
```

**Поле `is_internal`:** если `true` — это внутренняя заметка администратора, которая не видна пользователю.

**Поле `attachments`:**

```json
[
  {
    "file_name": "screenshot.png",
    "file_url": "/uploads/support/abc123.png",
    "file_size": 125000,
    "mime_type": "image/png"
  }
]
```

## 9.2. Support Module — Use Cases (User)

### UC-SUPPORT-01: Создать тикет

```http
POST /api/v1/support/tickets
Authorization: Bearer <token>
```

**Входные данные:**

```json
{
  "subject": "Не пришли средства",
  "category": "payments",
  "message": "Пополнил счёт на 5000 рублей через карту, прошло 30 минут, деньги не зачислены."
}
```

**Правила:**

- создать `support_tickets` со статусом `open`;
- создать первое `support_messages` с `sender_type = user`;
- уведомить администраторов (BullMQ);
- вернуть созданный тикет.

**Лимит:** пользователь может создать не более 5 открытых тикетов одновременно.

### UC-SUPPORT-02: Получить список тикетов пользователя

```http
GET /api/v1/support/tickets
Authorization: Bearer <token>
```

**Параметры:** page, per_page, status

**Возвращает:**

- только тикеты текущего пользователя;
- для каждого: subject, status, category, created_at, дата последнего сообщения.

### UC-SUPPORT-03: Получить тикет с сообщениями

```http
GET /api/v1/support/tickets/:id
Authorization: Bearer <token>
```

**Правила:**

- вернуть тикет + все сообщения где `is_internal = false`;
- проверить что тикет принадлежит текущему пользователю.

### UC-SUPPORT-04: Отправить сообщение в тикет

```http
POST /api/v1/support/tickets/:id/messages
Authorization: Bearer <token>
```

**Входные данные:**

```json
{
  "message": "Прикладываю скриншот оплаты."
}
```

**Правила:**

- тикет должен быть НЕ closed;
- создать `support_messages` с `sender_type = user`;
- если статус был `waiting_user` → обновить на `in_progress`;
- уведомить assigned admin (если есть).

### UC-SUPPORT-05: Загрузить вложение к сообщению

```http
POST /api/v1/support/tickets/:id/attachments
Content-Type: multipart/form-data
```

**Правила:**

- принимать: jpg, png, pdf, gif;
- максимум: 10 MB;
- максимум 3 файла на сообщение;
- сохранять в закрытую директорию.

### UC-SUPPORT-06: Закрыть тикет (пользователь)

```http
POST /api/v1/support/tickets/:id/close
Authorization: Bearer <token>
```

**Правила:**

- обновить `status = closed`;
- `closed_by = user`;
- `closed_at = now()`.

## 9.3. Support Module — Use Cases (Admin)

### UC-SUPPORT-07: Список всех тикетов

```http
GET /api/v1/admin/support/tickets
```

**Параметры:**

```text
page, per_page
status          — open, in_progress, waiting_user, closed
priority        — low, normal, high, urgent
category        — payments, games, technical, account, other
assigned_to     — UUID admin
user_id
search          — поиск по subject и сообщениям
from, to
```

**Таблица:**

```text
#ID | Пользователь | Тема | Категория | Приоритет | Статус | Назначен | Создан | Последнее сообщение
```

**Фильтры-вкладки:**

```text
[ Все ] [ Открытые (8) ] [ В работе (3) ] [ Ожидают ответа (2) ] [ Закрытые ]
```

### UC-SUPPORT-08: Просмотр тикета (Admin)

```http
GET /api/v1/admin/support/tickets/:id
```

**Страница:**

```text
[ ИНФОРМАЦИЯ О ТИКЕТЕ ]
  #ID | Тема | Категория | Приоритет | Статус
  Пользователь: email (кликабельно → карточка пользователя)
  Создан: дата
  Назначен: Admin Name или "Не назначен"

[ ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ — боковая панель ]
  Email
  Баланс
  KYC статус
  Дата регистрации
  Количество депозитов / выводов

[ ПЕРЕПИСКА ]
  Все сообщения включая internal notes
  Internal notes выделяются жёлтым фоном с пометкой "Внутренняя заметка"

[ ДЕЙСТВИЯ ]
  [Ответить]
  [Добавить внутреннюю заметку]
  [Назначить на себя]
  [Изменить приоритет]
  [Изменить статус]
  [Закрыть тикет]
```

### UC-SUPPORT-09: Ответить на тикет (Admin)

```http
POST /api/v1/admin/support/tickets/:id/messages
```

**Входные данные:**

```json
{
  "message": "Добрый день! Мы проверили вашу транзакцию...",
  "is_internal": false
}
```

**Правила:**

- создать `support_messages` с `sender_type = admin`;
- если `is_internal = true` — не показывать пользователю, не уведомлять;
- если `is_internal = false`:
  - обновить статус на `waiting_user`;
  - уведомить пользователя (email через BullMQ);
- обновить `updated_at` тикета;
- записать в `audit_log`.

### UC-SUPPORT-10: Назначить тикет

```http
POST /api/v1/admin/support/tickets/:id/assign
```

**Входные данные:**

```json
{ "admin_id": "..." }
```

или:

```json
{ "assign_to_self": true }
```

### UC-SUPPORT-11: Изменить приоритет

```http
PATCH /api/v1/admin/support/tickets/:id/priority
```

**Входные данные:**

```json
{ "priority": "high" }
```

### UC-SUPPORT-12: Закрыть тикет (Admin)

```http
POST /api/v1/admin/support/tickets/:id/close
```

**Правила:**

- `status = closed`;
- `closed_by = admin`;
- `closed_at = now()`;
- уведомить пользователя;
- записать в `audit_log`.

---

# 10. Реферальная система — Backend

## 10.1. Концепция

Каждый зарегистрированный пользователь имеет уникальный реферальный код. Когда приглашённый пользователь играет — реферер получает процент от GGR (Gross Gaming Revenue) приглашённого.

`GGR = сумма ставок − сумма выигрышей.`

На MVP реферер получает фиксированный процент от GGR реферала. Процент настраивается через env или admin settings: рекомендуемое значение — `5%`.

## 10.2. Сущности базы данных

### Таблица `referral_rewards`

```text
id                  UUID, PK
referrer_id         UUID, FK -> users.id
referred_id         UUID, FK -> users.id
type                ENUM(ggr_share, first_deposit_bonus)
period_start        DATE, not null
period_end          DATE, not null
ggr_amount          DECIMAL(20,8), not null
reward_rate         DECIMAL(5,4), not null
reward_amount       DECIMAL(20,8), not null
currency            VARCHAR(16), not null
status              ENUM(pending, credited, zero)
credited_at         TIMESTAMPTZ, nullable
ledger_entry_id     UUID, nullable, FK -> ledger_entries.id
created_at          TIMESTAMPTZ

INDEX(referrer_id)
INDEX(referred_id)
INDEX(status)
INDEX(period_start)
```

**Пояснение:**

- `period_start`, `period_end` — период за который считается GGR (например, день);
- `ggr_amount` — GGR реферала за период;
- `reward_rate` — `0.0500` (5%);
- `reward_amount` — начисленная сумма реферальных;
- `status`:
  - `pending` — рассчитано, но ещё не зачислено;
  - `credited` — зачислено на баланс реферера;
  - `zero` — GGR за период ≤ 0 (реферал выиграл).

## 10.3. Referral Module — Use Cases

### UC-REF-01: Генерация реферального кода

Происходит автоматически при регистрации пользователя.

Код: 8 символов, uppercase alphanumeric, уникальный. Пример: `ABC12XYZ`.

Хранится в `users.referral_code`.

### UC-REF-02: Привязка реферала при регистрации

При регистрации пользователь может передать `referral_code`.

**Алгоритм:**

```text
1. Найти пользователя по referral_code
2. Если не найден — игнорировать (не блокировать регистрацию)
3. Если найден:
   a. Записать referred_by = referrer.id в нового пользователя
   b. Нельзя быть рефералом самого себя
```

### UC-REF-03: Расчёт реферальных наград

BullMQ cron job, запускается **раз в день** в 02:00 по серверному времени.

**Алгоритм:**

```text
Для каждого пользователя у которого referred_by IS NOT NULL:

  1. Посчитать GGR за вчера:
     ggr = SUM(game_transactions.amount WHERE type = 'bet')
         - SUM(game_transactions.amount WHERE type = 'win')
     За период: вчера 00:00 — 23:59:59

  2. Если ggr <= 0:
     Создать referral_rewards с status = zero, reward_amount = 0
     Продолжить

  3. Если ggr > 0:
     reward_amount = ggr * reward_rate (5%)

  4. Создать referral_rewards с status = pending

  5. Зачислить на баланс реферера:
     walletService.credit({
       userId: referrer_id,
       currency: currency,
       amount: reward_amount,
       type: 'REFERRAL_REWARD',
       idempotencyKey: 'ref_reward_' + referrer_id + '_' + referred_id + '_' + date,
       description: 'Реферальное вознаграждение',
       metadata: { referred_id, period: date, ggr: ggr_amount }
     })

  6. Обновить referral_rewards.status = credited

  7. Emit event REFERRAL_REWARD_CREDITED
```

**Валюта:** считать в валюте, в которой играл реферал. Если реферал играл в нескольких валютах — считать по каждой отдельно.

### UC-REF-04: Получить реферальную информацию (User)

```http
GET /api/v1/referrals/info
Authorization: Bearer <token>
```

**Ответ:**

```json
{
  "success": true,
  "data": {
    "referral_code": "ABC12XYZ",
    "referral_link": "https://casino.example.com?ref=ABC12XYZ",
    "reward_rate": "5%",
    "total_referrals": 25,
    "active_referrals": 12,
    "total_earned": { "RUB": "5450.00" },
    "pending_rewards": { "RUB": "0.00" }
  }
}
```

### UC-REF-05: Получить список рефералов (User)

```http
GET /api/v1/referrals/list
Authorization: Bearer <token>
```

**Параметры:** page, per_page

**Ответ:**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "registered_at": "2024-01-01",
      "is_active": true,
      "total_earned": "500.00",
      "currency": "RUB"
    }
  ]
}
```

**Правила:**

- НЕ показывать email или имя реферала (конфиденциальность);
- показывать только ID (короткий), дату, статус, сумму;
- `is_active = делал ставки за последние 30 дней`.

### UC-REF-06: Получить историю начислений (User)

```http
GET /api/v1/referrals/rewards
Authorization: Bearer <token>
```

**Параметры:** page, per_page, from, to

**Ответ:**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "date": "2024-01-15",
      "referred_user_id": "short-id",
      "ggr_amount": "1000.00",
      "reward_rate": "0.05",
      "reward_amount": "50.00",
      "currency": "RUB",
      "status": "credited"
    }
  ]
}
```

### UC-REF-07: Реферальная статистика (Admin)

```http
GET /api/v1/admin/referrals/stats
```

**Ответ:**

```json
{
  "success": true,
  "data": {
    "total_referrals": 500,
    "total_rewards_paid": "25000.00",
    "top_referrers": [
      {
        "user_id": "...",
        "email": "...",
        "referral_count": 50,
        "total_earned": "5000.00"
      }
    ]
  }
}
```

### UC-REF-08: Список всех рефералов (Admin)

```http
GET /api/v1/admin/referrals
```

**Параметры:** page, per_page, referrer_id, referred_id, from, to

**Таблица:**

```text
Реферер | Реферал | Дата регистрации | GGR реферала | Выплачено реферальных | Статус
```

---

# 11. Система уведомлений — Backend

## 11.1. Концепция

На MVP уведомления отправляются через email. В будущем можно добавить Telegram, push.

## 11.2. Сущности базы данных

### Таблица `notifications`

```text
id              UUID, PK
user_id         UUID, FK -> users.id
type            VARCHAR(64), not null
channel         ENUM(email, internal), not null
title           VARCHAR(255), not null
message         TEXT, not null
data            JSONB, default '{}'
is_read         BOOLEAN, default false
sent_at         TIMESTAMPTZ, nullable
read_at         TIMESTAMPTZ, nullable
created_at      TIMESTAMPTZ

INDEX(user_id)
INDEX(type)
INDEX(is_read)
INDEX(created_at)
```

**Значения `type`:**

```text
email_verification
password_reset
kyc_approved
kyc_rejected
kyc_resubmission
deposit_completed
withdrawal_completed
withdrawal_rejected
support_reply
referral_reward
account_blocked
account_unblocked
admin_balance_credit
admin_balance_debit
```

## 11.3. Notification Module — Use Cases

### UC-NOTIF-01: Создать и отправить уведомление

Внутренний метод, вызываемый из других модулей.

```ts
notificationService.send({
  userId: userId,
  type:   'deposit_completed',
  channel:'email',
  title:  'Баланс пополнен',
  message:'Ваш баланс пополнен на 5 000 ₽',
  data:   { amount: '5000.00', currency: 'RUB' }
})
```

**Алгоритм:**

```text
1. Создать запись в notifications
2. Проверить user_settings — включены ли email уведомления
3. Если да — добавить в BullMQ email queue
4. Отправить email
5. Обновить sent_at
```

### UC-NOTIF-02: Получить уведомления пользователя

```http
GET /api/v1/notifications
Authorization: Bearer <token>
```

**Параметры:** page, per_page, is_read

### UC-NOTIF-03: Пометить как прочитанное

```http
POST /api/v1/notifications/:id/read
Authorization: Bearer <token>
```

### UC-NOTIF-04: Пометить все как прочитанные

```http
POST /api/v1/notifications/read-all
Authorization: Bearer <token>
```

### UC-NOTIF-05: Получить количество непрочитанных

```http
GET /api/v1/notifications/unread-count
Authorization: Bearer <token>
```

**Ответ:**

```json
{
  "success": true,
  "data": { "count": 3 }
}
```

---

# 12. Управление администраторами

## 12.1. Только для superadmin

**Маршрут:** `/admins`

### UC-ADMIN-MGMT-01: Список администраторов

```http
GET /api/v1/admin/admins
```

**Таблица:**

```text
ID | Email | Имя | Роль | Активен | Последний вход | Создан | Создал | Действия
```

### UC-ADMIN-MGMT-02: Создать администратора

```http
POST /api/v1/admin/admins
```

**Входные данные:**

```json
{
  "email": "admin@example.com",
  "password": "...",
  "first_name": "Алексей",
  "last_name": "Иванов",
  "role": "admin"
}
```

**Правила:**

- только superadmin может создавать;
- записать `created_by`;
- хешировать пароль;
- записать в `audit_log`.

### UC-ADMIN-MGMT-03: Обновить администратора

```http
PATCH /api/v1/admin/admins/:id
```

Можно изменить: `first_name`, `last_name`, `role`, `is_active`.

### UC-ADMIN-MGMT-04: Сбросить пароль администратора

```http
POST /api/v1/admin/admins/:id/reset-password
```

**Входные данные:**

```json
{ "new_password": "..." }
```

### UC-ADMIN-MGMT-05: Деактивировать администратора

```http
POST /api/v1/admin/admins/:id/deactivate
```

- `is_active = false`;
- инвалидировать все сессии администратора;
- `audit_log`.

---

# 13. Глобальные настройки

## 13.1. Только для superadmin

**Маршрут:** `/settings`

### UC-ADMIN-SETTINGS-01: Получить настройки

```http
GET /api/v1/admin/settings
```

### UC-ADMIN-SETTINGS-02: Обновить настройки

```http
PATCH /api/v1/admin/settings
```

## 13.2. Доступные настройки

### Таблица `system_settings`

```text
id          UUID, PK
key         VARCHAR(128), UNIQUE
value       TEXT
type        ENUM(string, number, boolean, json)
category    VARCHAR(64)
description TEXT
updated_by  UUID, nullable
updated_at  TIMESTAMPTZ
```

### Настройки MVP

```text
Категория: KYC
  kyc_deposit_limit_rub         — 5000    (порог для KYC)

Категория: Payments
  min_deposit_rub               — 100
  max_deposit_rub               — 500000
  min_withdrawal_rub            — 500
  max_withdrawal_rub            — 200000
  withdrawal_fee_percent        — 0

Категория: Referral
  referral_reward_rate          — 0.05   (5%)
  referral_enabled              — true

Категория: Maintenance
  maintenance_mode              — false
  maintenance_message           — ""

Категория: Games
  max_concurrent_sessions       — 3
  session_expiry_hours          — 2
```

## 13.3. Страница настроек в админке

```text
[ ВКЛАДКИ ]
  KYC | Платежи | Рефералы | Обслуживание | Игры

[ ТАБ: KYC ]
  Лимит депозитов без верификации (RUB):
  [ 5000 ]

[ ТАБ: Платежи ]
  Мин. депозит (RUB):   [ 100     ]
  Макс. депозит (RUB):  [ 500000  ]
  Мин. вывод (RUB):     [ 500     ]
  Макс. вывод (RUB):    [ 200000  ]
  Комиссия вывода (%):  [ 0 ]

[ ТАБ: Рефералы ]
  Реферальная программа:      [ ✓ Включена ]
  Процент вознаграждения:     [ 5 ] %

[ ТАБ: Обслуживание ]
  Режим обслуживания:         [ □ Выключен ]
  Сообщение:                  [ ______________________ ]
  ⚠️ При включении все пользователи увидят страницу "Техработы"

[ ТАБ: Игры ]
  Макс. одновременных сессий: [ 3 ]
  Время жизни сессии (часов):[ 2 ]

[Сохранить]
```

Все изменения записываются в `audit_log`.

---

# 14. Audit Logs в админке

**Маршрут:** `/audit`

### UC-ADMIN-AUDIT-01: Просмотр журнала

```http
GET /api/v1/admin/audit-logs
```

**Параметры:**

```text
page, per_page
actor_type      — user, admin, system
actor_id
action          — полный или частичный (admin.kyc.*)
target_type     — user, kyc_profile, payment_request, support_ticket, ...
target_id
from, to
```

**Таблица:**

```text
Дата/Время | Исполнитель | Тип | Действие | Цель | IP | Детали (expandable)
```

**Детали:** JSON payload с подробностями действия.

---

# 15. Шаблоны Email

## 15.1. Список шаблонов для MVP

Создать HTML шаблоны для каждого типа уведомления.

### Шаблон: Подтверждение email

```text
Тема: Подтвердите ваш email

Здравствуйте!

Для подтверждения email перейдите по ссылке:
[ Подтвердить email ]

Ссылка действительна 24 часа.

Если вы не регистрировались — проигнорируйте это письмо.
```

### Шаблон: Сброс пароля

```text
Тема: Сброс пароля

Для сброса пароля перейдите по ссылке:
[ Сбросить пароль ]

Ссылка действительна 1 час.
```

### Шаблон: KYC одобрен

```text
Тема: Верификация пройдена

Ваш аккаунт успешно верифицирован!

Теперь вам доступны:
  • Неограниченные пополнения
  • Вывод средств
```

### Шаблон: KYC отклонён

```text
Тема: Верификация не пройдена

К сожалению, ваша заявка отклонена.
Причина: {{ reason }}

Вы можете подать заявку повторно.
[ Подать заново ]
```

### Шаблон: KYC повторная отправка

```text
Тема: Требуется дополнительная информация

Для завершения верификации нужны дополнительные документы.
Причина: {{ reason }}

[ Загрузить документы ]
```

### Шаблон: Депозит завершён

```text
Тема: Баланс пополнен

Ваш баланс пополнен на {{ amount }} {{ currency }}.
Текущий баланс: {{ balance }}

[ Играть ]
```

### Шаблон: Вывод одобрен

```text
Тема: Вывод обработан

Ваша заявка на вывод {{ amount }} {{ currency }} одобрена.
Средства будут переведены в ближайшее время.
```

### Шаблон: Вывод отклонён

```text
Тема: Вывод отклонён

Ваша заявка на вывод {{ amount }} {{ currency }} отклонена.
Причина: {{ reason }}
Средства возвращены на баланс.
```

### Шаблон: Ответ поддержки

```text
Тема: Ответ на ваше обращение #{{ ticket_id }}

Получен ответ по вашему обращению "{{ subject }}":

{{ message }}

[ Перейти к обращению ]
```

### Шаблон: Реферальное вознаграждение

```text
Тема: Реферальное вознаграждение

Вам начислено реферальное вознаграждение: {{ amount }} {{ currency }}

Продолжайте приглашать друзей и зарабатывать!
[ Реферальная программа ]
```

### Шаблон: Аккаунт заблокирован

```text
Тема: Аккаунт заблокирован

Ваш аккаунт был заблокирован.
Если вы считаете что это ошибка — обратитесь в поддержку.
```

### Шаблон: Аккаунт разблокирован

```text
Тема: Аккаунт разблокирован

Ваш аккаунт разблокирован. Вы снова можете пользоваться платформой.
[ Войти ]
```

## 15.2. Реализация шаблонов

- каждый шаблон — отдельный HTML файл;
- использовать шаблонизатор (Handlebars или простую строковую замену);
- общий wrapper с хедером (логотип) и футером (контакты, отписка);
- адаптивная HTML верстка для email;
- тестировать рендеринг в основных email клиентах.

---

# 16. Admin Panel Frontend — Технические задачи Части 6

## Блок A. Admin Foundation и Layout

### Задачи

1. Создать `apps/admin` на Next.js.
2. Реализовать Login страницу для администраторов.
3. Реализовать Admin Layout с Header и Sidebar.
4. Реализовать navigation с подсветкой активного раздела.
5. Реализовать AuthProvider для admin с отдельным auth flow.
6. Реализовать protected routes middleware.
7. Реализовать role-based visibility (скрывать superadmin-only секции).

### Критерий приёмки

- admin login работает с отдельным endpoint;
- layout отображается корректно;
- не-superadmin не видит секции управления админами и настроек;
- при невалидном токене — редирект на login.

## Блок B. Дашборд

### Задачи

1. Реализовать карточки метрик.
2. Реализовать график доходов (Recharts).
3. Реализовать график регистраций.
4. Реализовать Quick Actions с badge.
5. Реализовать ленту последних событий.
6. Реализовать API endpoints для дашборда.

### Критерий приёмки

- метрики отображают актуальные данные;
- графики рисуются за выбранный период;
- Quick Actions показывают количество pending;
- события подгружаются.

## Блок C. Пользователи

### Задачи

1. Реализовать страницу списка пользователей с TanStack Table.
2. Реализовать все фильтры и сортировки.
3. Реализовать карточку пользователя со всеми вкладками.
4. Реализовать модалку ручного зачисления.
5. Реализовать модалку ручного списания.
6. Реализовать блокировку / разблокировку с модалкой причины.

### Критерий приёмки

- список с пагинацией и фильтрами работает;
- карточка отображает все данные;
- ручная корректировка баланса работает и записывается в аудит;
- блокировка работает и инвалидирует сессии.

## Блок D. Финансы

### Задачи

1. Реализовать страницу всех транзакций.
2. Реализовать страницу платёжных запросов.
3. Реализовать детали платёжного запроса с raw callbacks.
4. Реализовать страницу заявок на вывод.
5. Реализовать одобрение / отклонение вывода.
6. Реализовать массовые действия с выводами.

### Критерий приёмки

- все таблицы с фильтрами и пагинацией;
- одобрение списывает средства;
- отклонение разблокирует средства;
- массовые действия работают;
- raw callbacks доступны для просмотра.

## Блок E. KYC

### Задачи

1. Реализовать страницу списка KYC заявок с вкладками по статусу.
2. Реализовать страницу детальной KYC заявки.
3. Реализовать просмотр загруженных документов (lightbox).
4. Реализовать одобрение / отклонение / повторную отправку.

### Критерий приёмки

- заявки видны с фильтрами;
- документы просматриваются;
- одобрение / отклонение обновляет статус и уведомляет пользователя.

## Блок F. Казино (Admin)

### Задачи

1. Реализовать страницу провайдеров.
2. Реализовать страницу настроек провайдера.
3. Реализовать синхронизацию игр.
4. Реализовать страницу игр с массовыми действиями.
5. Реализовать редактирование игры.
6. Реализовать просмотр игровых сессий.

### Критерий приёмки

- провайдеры управляются;
- sync-games добавляет новые игры;
- игры включаются / выключаются / featured;
- сессии просматриваются с детализацией.

## Блок G. Support Backend + Admin

### Задачи

1. Создать `modules/support`.
2. Создать Prisma schema для `support_tickets` и `support_messages`.
3. Реализовать все user use cases (создание, просмотр, ответ, закрытие).
4. Реализовать все admin use cases (список, ответ, назначение, приоритет, закрытие).
5. Реализовать загрузку вложений.
6. Реализовать internal notes.
7. Реализовать лимит открытых тикетов.
8. Реализовать страницу тикетов в админке.
9. Реализовать страницу конкретного тикета в админке с перепиской.

### Критерий приёмки

- пользователь может создать тикет и вести переписку;
- admin видит все тикеты с фильтрами;
- admin может отвечать, назначать, менять приоритет;
- internal notes не видны пользователю;
- вложения загружаются и доступны.

## Блок H. Referral System Backend

### Задачи

1. Создать `modules/referrals`.
2. Создать Prisma schema для `referral_rewards`.
3. Реализовать генерацию реферальных кодов при регистрации.
4. Реализовать привязку реферала.
5. Реализовать BullMQ cron job для расчёта вознаграждений.
6. Реализовать user endpoints (info, list, rewards).
7. Реализовать admin endpoints (stats, list).
8. Реализовать страницу рефералов в админке.

### Критерий приёмки

- реферальный код создаётся при регистрации;
- регистрация с кодом привязывает реферала;
- ежедневный job рассчитывает и зачисляет вознаграждения;
- пользователь видит статистику и начисления;
- admin видит общую статистику.

## Блок I. Notification System

### Задачи

1. Создать `modules/notifications`.
2. Создать Prisma schema для `notifications`.
3. Реализовать `NotificationService.send`.
4. Реализовать user endpoints (list, read, read-all, unread-count).
5. Создать все email шаблоны (12 шаблонов).
6. Интегрировать отправку уведомлений во все модули.
7. Реализовать email worker в BullMQ.

### Критерий приёмки

- email отправляются для всех сценариев;
- шаблоны рендерятся корректно;
- пользователь видит уведомления;
- прочитанные / непрочитанные работают;
- retry при ошибке отправки.

## Блок J. Admin Management и Settings

### Задачи

1. Реализовать CRUD администраторов (superadmin only).
2. Реализовать деактивацию администратора.
3. Реализовать сброс пароля администратора.
4. Создать Prisma schema для `system_settings`.
5. Реализовать API для settings (get / update).
6. Реализовать страницу настроек в админке.
7. Реализовать страницу управления администраторами.
8. Реализовать страницу аудит-логов.
9. Все изменения settings → `audit_log`.

### Критерий приёмки

- superadmin может создавать / деактивировать / менять пароль admin;
- настройки сохраняются и применяются;
- audit logs отображаются с фильтрами;
- все admin-only страницы недоступны обычному admin.

---

# 17. Что НЕ делать в Части 6

- real-time уведомления через WebSocket в админке;
- Telegram bot для уведомлений;
- push уведомления в браузере;
- экспорт данных в Excel / CSV (можно добавить позже);
- dashboard real-time auto-refresh (достаточно ручного refresh);
- multi-language в админке;
- система логирования действий пользователя на фронте (session replay).

---

> Если готов — напиши **"продолжай"**, и я дам **Часть 7: DevOps, Security, Logging, QA, Release Prep** — финальную часть ТЗ.
