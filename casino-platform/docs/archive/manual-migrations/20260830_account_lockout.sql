-- GAP-18: account lockout after repeated failed logins (SECURITY_BASELINE §2.2)
-- 10 неудачных попыток за 15 минут → блокировка входа на 30 минут.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_failed_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMPTZ;
