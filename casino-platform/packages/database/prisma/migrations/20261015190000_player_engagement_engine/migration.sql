-- ТЗ ч.9 §3.1 — состояние движка вовлечения по паре (игрок, игра).
--
-- 1) player_engagement_states — один ряд на пару (user_id, game_id). Читается и пишется
--    на каждом спине, поэтому уникальный индекс на пару — основной путь доступа.
--    Кольцевые буферы §6.2 лежат в behavior JSONB, снапшот §3.2 — в session_metadata.
-- 2) engagement_events — append-only журнал решений движка (§11.3): фаза, RTP, LDW,
--    Near-Miss, кредит реактивации. Ссылка на game_sessions.id намеренно без FK:
--    журнал живёт дольше сессии и не должен блокировать её удаление.
--
-- Денежные величины — NUMERIC(20,8), как в кошельке и game_transactions.
-- Дрейф RTP — NUMERIC(20,8) в единицах ставки (§7.3).

CREATE TYPE "EngagementPhase" AS ENUM (
    'onboarding',
    'retention',
    'risk',
    'reactivation',
    'cooldown',
    'dormant'
);

CREATE TYPE "EngagementEventType" AS ENUM (
    'phase_changed',
    'rtp_adjusted',
    'ldw_applied',
    'near_miss_applied',
    'reactivation_credited'
);

CREATE TABLE "player_engagement_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "phase" "EngagementPhase" NOT NULL DEFAULT 'onboarding',
    "rtp_drift" NUMERIC(20, 8) NOT NULL DEFAULT 0,
    "total_spins" INTEGER NOT NULL DEFAULT 0,
    "total_bet" NUMERIC(20, 8) NOT NULL DEFAULT 0,
    "total_win" NUMERIC(20, 8) NOT NULL DEFAULT 0,
    "last_win_amount" NUMERIC(20, 8) NOT NULL DEFAULT 0,
    "max_win_in_session" NUMERIC(20, 8) NOT NULL DEFAULT 0,
    "ldw_count" INTEGER NOT NULL DEFAULT 0,
    "near_miss_count" INTEGER NOT NULL DEFAULT 0,
    "last_ldw_spin" INTEGER NOT NULL DEFAULT 0,
    "spins_since_reactivation" INTEGER NOT NULL DEFAULT 0,
    "last_reactivation_spin" INTEGER NOT NULL DEFAULT 0,
    "reactivation_count" INTEGER NOT NULL DEFAULT 0,
    "current_balance" NUMERIC(20, 8) NOT NULL DEFAULT 0,
    "initial_deposit" NUMERIC(20, 8) NOT NULL DEFAULT 0,
    "behavior" JSONB NOT NULL DEFAULT '{}',
    "session_metadata" JSONB NOT NULL DEFAULT '{}',
    "last_engagement_spin_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_engagement_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "engagement_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "session_id" UUID,
    "event_type" "EngagementEventType" NOT NULL,
    "spin_index" INTEGER,
    "phase" "EngagementPhase",
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_events_pkey" PRIMARY KEY ("id")
);

-- Основной доступ: состояние пары «игрок + игра».
CREATE UNIQUE INDEX "player_engagement_states_user_id_game_id_key"
    ON "player_engagement_states" USING btree ("user_id", "game_id");

-- Выборка «все пары игрока» для чтения без сканирования по game_id.
CREATE INDEX "player_engagement_states_user_id_updated_at_idx"
    ON "player_engagement_states" USING btree ("user_id", "updated_at");

-- Журнал: аналитика по паре и разбор инцидентов по типу события.
CREATE INDEX "engagement_events_user_id_game_id_created_at_idx"
    ON "engagement_events" USING btree ("user_id", "game_id", "created_at");

CREATE INDEX "engagement_events_event_type_created_at_idx"
    ON "engagement_events" USING btree ("event_type", "created_at");

ALTER TABLE "player_engagement_states"
    ADD CONSTRAINT "player_engagement_states_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_engagement_states"
    ADD CONSTRAINT "player_engagement_states_game_id_fkey"
        FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "engagement_events"
    ADD CONSTRAINT "engagement_events_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;