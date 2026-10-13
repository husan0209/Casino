-- Регулируемый возврат: rtp остаётся целью для игры на деньги,
-- rtp_demo — отдельная цель демо-режима. Обе величины сервер использует
-- как вход генератора таблиц множителей (plinko.rtp-pack.ts).

ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "rtp_demo" DECIMAL(5,2);
