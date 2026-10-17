-- ТЗ ч.8 §658 «сброс пароля партнёра».
--
-- Токен живёт на самой записи `affiliates`, а не в `password_resets`: та таблица
-- принадлежит auth-модулю и привязана FK к `users`, а партнёрский хеш — здесь.
-- Компаньон-строка игрока заводится с `email: null`
-- (provision-affiliate-player.use-case.ts), поэтому существующий «забыли пароль»
-- партнёра не находит и достучаться до почты через него нельзя.
--
-- Активный токен один: новый запрос перезаписывает старый, успешный сброс
-- обнуляет оба поля. NULL в уникальном индексе Postgres не считается
-- коллизией, поэтому колонка может быть пустой у всех сразу.

ALTER TABLE "affiliates"
  ADD COLUMN IF NOT EXISTS "password_reset_token" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "password_reset_expires_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_password_reset_token_key"
  ON "affiliates" ("password_reset_token");
