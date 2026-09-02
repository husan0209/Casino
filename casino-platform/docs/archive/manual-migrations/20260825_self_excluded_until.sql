-- RG baseline: self-exclusion support on user_settings (tz-part-2 §Ответственная игра)
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "self_excluded_until" TIMESTAMPTZ;
