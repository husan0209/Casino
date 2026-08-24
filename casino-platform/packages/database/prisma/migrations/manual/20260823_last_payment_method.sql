-- Manual migration: add last_payment_method to user_profiles
-- Run: psql $DATABASE_URL -f packages/database/prisma/migrations/manual/20260823_last_payment_method.sql

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_payment_method VARCHAR(64);
