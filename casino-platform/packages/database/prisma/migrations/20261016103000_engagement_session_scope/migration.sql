-- ТЗ ч.9 §3.1/§4.3/§10.1 — уточнение сессионного контура движка вовлечения.
--
-- 1) peak_balance — §3.1 «Пик баланса в сессии»: обновляется на каждом спине,
--    попадает в снапшот §3.2 и аналитику §11.1.
-- 2) last_session_id — §10.1 resetState: смена сессии перезапускает цикл §4.1
--    и лимит реактиваций §4.2 («за сессию»).
-- 3) last_reactivation_spin становится nullable: NULL = «реактиваций не было»,
--    а 0 — легальный номер спина (нумерация с нуля, как last_ldw_spin). Прежний
--    сентинел 0 → NULL выполняется ДО снятия NOT NULL, чтобы не потерять смысл.
-- 4) spins_since_reactivation удаляется: производное значение total_spins −
--    last_reactivation_spin (§4.3), в схеме ТЗ ч.9 такой колонки нет.

ALTER TABLE "player_engagement_states"
    ADD COLUMN "peak_balance" NUMERIC(20, 8) NOT NULL DEFAULT 0;

ALTER TABLE "player_engagement_states"
    ADD COLUMN "last_session_id" UUID;

UPDATE "player_engagement_states"
    SET "last_reactivation_spin" = NULL
    WHERE "last_reactivation_spin" = 0;

ALTER TABLE "player_engagement_states"
    ALTER COLUMN "last_reactivation_spin" DROP NOT NULL;

ALTER TABLE "player_engagement_states"
    ALTER COLUMN "last_reactivation_spin" DROP DEFAULT;

ALTER TABLE "player_engagement_states"
    DROP COLUMN "spins_since_reactivation";
