Ручные SQL-скрипты — исторические альтерации (2026-08-23 … 2026-08-30):

- 20260823_last_payment_method.sql   — users.last_payment_method
- 20260825_self_excluded_until.sql   — user_profiles.self_excluded_until
- 20260830_account_lockout.sql       — users.failed_login_attempts / last_failed_at / locked_until

С 2026-09-01 все эти изменения ВКЛЮЧЕНЫ в baseline-миграцию migrations/0_init
(сгенерирована из schema.prisma через prisma migrate diff --from-empty).

НЕ ПРИМЕНЯТЬ ЭТИ ФАЙЛЫ ВРУЧНУЮ на свежих БД — schema.prisma + prisma migrate
deploy покрывают всё. Файлы оставлены для истории: как они применялись на БД,
созданных до введения миграций (учётка _prisma_migrations на них пустая —
на таких БД один раз выполнить: npx prisma migrate resolve --applied 0_init).
