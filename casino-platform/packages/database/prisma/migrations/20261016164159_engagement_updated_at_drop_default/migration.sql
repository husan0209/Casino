-- ТЗ ч.9 — выравнивание player_engagement_states со схемой Prisma.
--
-- Миграция 20261015190000 вручную задала updated_at DEFAULT CURRENT_TIMESTAMP,
-- однако ни модель Prisma (@updatedAt), ни миграции других таблиц такого
-- DB-дефолта не создают: значение всегда проставляет Prisma Client.
-- Из-за этого `prisma migrate diff` показывал дрейф
-- «updated_at: default changed from Some(Now) to None», и следующий
-- `prisma migrate dev` сгенерировал бы эту же правку случайной миграцией.
-- Снимаем дефолт явно.
ALTER TABLE "player_engagement_states"
    ALTER COLUMN "updated_at" DROP DEFAULT;
