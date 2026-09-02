Historical manual SQL-скрипты — альтерации, применявшиеся до введения
Prisma-миграций (2026-08-23 … 2026-08-30):

- 20260823_last_payment_method.sql   — users.last_payment_method
- 20260825_self_excluded_until.sql   — user_profiles.self_excluded_until
- 20260830_account_lockout.sql       — users.failed_login_attempts / last_failed_at / locked_until

С 2026-09-02 (GAP-31) все эти изменения включены в baseline-миграцию
packages/database/prisma/migrations/0_init/migration.sql, сгенерированную
из schema.prisma командой prisma migrate diff --from-empty.

Файлы перенесены из packages/database/prisma/migrations/manual/ в
docs/archive/manual-migrations/: Prisma трактует КАЖДЫЙ подкаталог
migrations/ как миграцию с обязательным migration.sql (иначе ошибка
P3015 при migrate deploy).

На БД, созданных ДО введения миграций (в _prisma_migrations пусто),
один раз выполнить: npx prisma migrate resolve --applied 0_init —
и далее только prisma migrate deploy.
