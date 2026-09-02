-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'blocked', 'suspended');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin', 'superadmin');

-- CreateEnum
CREATE TYPE "AuthProviderType" AS ENUM ('email', 'google', 'telegram');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('not_started', 'pending', 'approved', 'rejected', 'requires_resubmission');

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('passport', 'id_card', 'drivers_license');

-- CreateEnum
CREATE TYPE "KycFileType" AS ENUM ('front', 'back', 'selfie', 'proof_of_address');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('admin', 'superadmin');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'admin', 'system');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'WITHDRAWAL_LOCK', 'WITHDRAWAL_UNLOCK', 'WITHDRAWAL_CONFIRM', 'BET', 'WIN', 'ROLLBACK', 'BONUS', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'REFERRAL_REWARD', 'CONVERSION_DEBIT', 'CONVERSION_CREDIT');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('deposit', 'withdrawal');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('rukassa', 'nowpayments', 'manual');

-- CreateEnum
CREATE TYPE "GameProviderType" AS ENUM ('slots', 'live_casino', 'table_games', 'other');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('slot', 'live_roulette', 'live_blackjack', 'live_baccarat', 'live_poker', 'live_game_show', 'table_game', 'crash', 'dice', 'other');

-- CreateEnum
CREATE TYPE "GameCategory" AS ENUM ('slots', 'live_casino', 'table_games', 'instant_games', 'other');

-- CreateEnum
CREATE TYPE "GameVolatility" AS ENUM ('low', 'medium', 'high', 'very_high');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('active', 'closed', 'expired');

-- CreateEnum
CREATE TYPE "GameRoundStatus" AS ENUM ('open', 'closed', 'rolled_back');

-- CreateEnum
CREATE TYPE "GameTransactionType" AS ENUM ('bet', 'win', 'rollback');

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('payments', 'games', 'technical', 'account', 'other');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'in_progress', 'waiting_user', 'closed');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "SupportClosedBy" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "SupportSenderType" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "ReferralRewardType" AS ENUM ('ggr_share', 'first_deposit_bonus');

-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('pending', 'credited', 'zero');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'internal');

-- CreateEnum
CREATE TYPE "SystemSettingType" AS ENUM ('string', 'number', 'boolean', 'json');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "username" VARCHAR(64),
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "referral_code" VARCHAR(32) NOT NULL,
    "referred_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "last_login_at" TIMESTAMPTZ,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_failed_at" TIMESTAMPTZ,
    "locked_until" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "AuthProviderType" NOT NULL,
    "provider_user_id" TEXT,
    "provider_email" TEXT,
    "provider_data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    "device_info" JSONB,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(128),
    "last_name" VARCHAR(128),
    "date_of_birth" DATE,
    "phone" VARCHAR(32),
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "country" VARCHAR(2),
    "city" VARCHAR(128),
    "avatar_url" TEXT,
    "currency_preference" VARCHAR(10) NOT NULL DEFAULT 'RUB',
    "last_payment_method" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "notifications_email" BOOLEAN NOT NULL DEFAULT true,
    "notifications_push" BOOLEAN NOT NULL DEFAULT true,
    "two_fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_fa_secret" TEXT,
    "language" VARCHAR(8) NOT NULL DEFAULT 'ru',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
    "self_excluded_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'not_started',
    "first_name" VARCHAR(128),
    "last_name" VARCHAR(128),
    "date_of_birth" DATE,
    "country" VARCHAR(2),
    "document_type" "KycDocumentType",
    "document_number" VARCHAR(64),
    "document_expiry" DATE,
    "rejection_reason" TEXT,
    "approved_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "submitted_at" TIMESTAMPTZ,
    "reviewed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kyc_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kyc_profile_id" UUID NOT NULL,
    "document_type" "KycFileType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "file_size" INTEGER,
    "mime_type" VARCHAR(64),
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "first_name" VARCHAR(128),
    "last_name" VARCHAR(128),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(128) NOT NULL,
    "target_type" VARCHAR(64),
    "target_id" UUID,
    "payload" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "locked" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "wallet_account_id" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "balance_before" DECIMAL(20,8) NOT NULL,
    "balance_after" DECIMAL(20,8) NOT NULL,
    "idempotency_key" VARCHAR(255),
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "provider" "PaymentProvider" NOT NULL,
    "method" VARCHAR(64),
    "currency" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "amount_rub" DECIMAL(20,2),
    "fee" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "external_id" VARCHAR(255),
    "external_status" VARCHAR(64),
    "payment_url" TEXT,
    "destination" JSONB,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "expires_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_callbacks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(32) NOT NULL,
    "external_id" VARCHAR(255),
    "payment_request_id" UUID,
    "raw_headers" JSONB,
    "raw_body" TEXT,
    "ip_address" VARCHAR(64),
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processing_result" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "currency_from" VARCHAR(16) NOT NULL,
    "currency_to" VARCHAR(16) NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "source" VARCHAR(32),
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "type" "GameProviderType" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "api_url" TEXT,
    "api_key" TEXT,
    "api_secret" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "logo_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "game_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "game_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "external_game_id" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_ru" VARCHAR(255),
    "type" "GameType" NOT NULL,
    "category" "GameCategory" NOT NULL,
    "subcategory" VARCHAR(64),
    "thumbnail_url" TEXT,
    "banner_url" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "has_demo" BOOLEAN NOT NULL DEFAULT true,
    "rtp" DECIMAL(5,2),
    "volatility" "GameVolatility",
    "max_win_multiplier" DECIMAL(10,2),
    "min_bet" DECIMAL(20,8),
    "max_bet" DECIMAL(20,8),
    "supported_currencies" JSONB NOT NULL DEFAULT '[]',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "launch_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "session_token" VARCHAR(255) NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'active',
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "total_bet" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "total_win" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "rounds_played" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_round_id" VARCHAR(255) NOT NULL,
    "status" "GameRoundStatus" NOT NULL DEFAULT 'open',
    "currency" VARCHAR(16) NOT NULL,
    "total_bet" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "total_win" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "round_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "type" "GameTransactionType" NOT NULL,
    "external_transaction_id" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "balance_after" DECIMAL(20,8) NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT true,
    "ledger_entry_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_favorites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "category" "SupportTicketCategory" NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'normal',
    "assigned_to" UUID,
    "closed_at" TIMESTAMPTZ,
    "closed_by" "SupportClosedBy",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "sender_type" "SupportSenderType" NOT NULL,
    "sender_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referrer_id" UUID NOT NULL,
    "referred_id" UUID NOT NULL,
    "type" "ReferralRewardType" NOT NULL DEFAULT 'ggr_share',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "ggr_amount" DECIMAL(20,8) NOT NULL,
    "reward_rate" DECIMAL(5,4) NOT NULL,
    "reward_amount" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'pending',
    "credited_at" TIMESTAMPTZ,
    "ledger_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(128) NOT NULL,
    "value" TEXT NOT NULL,
    "type" "SystemSettingType" NOT NULL,
    "category" VARCHAR(64),
    "description" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "auth_providers_provider_provider_user_id_key" ON "auth_providers"("provider", "provider_user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verifications_token_key" ON "email_verifications"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_key" ON "password_resets"("token");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_profiles_user_id_key" ON "kyc_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_idx" ON "audit_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "wallet_accounts_user_id_idx" ON "wallet_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_user_id_currency_key" ON "wallet_accounts"("user_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_account_id_idx" ON "ledger_entries"("wallet_account_id");

-- CreateIndex
CREATE INDEX "ledger_entries_created_at_idx" ON "ledger_entries"("created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_type_idx" ON "ledger_entries"("type");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_idempotency_key_key" ON "payment_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_requests_user_id_idx" ON "payment_requests"("user_id");

-- CreateIndex
CREATE INDEX "payment_requests_status_idx" ON "payment_requests"("status");

-- CreateIndex
CREATE INDEX "exchange_rates_currency_from_currency_to_idx" ON "exchange_rates"("currency_from", "currency_to");

-- CreateIndex
CREATE UNIQUE INDEX "game_providers_slug_key" ON "game_providers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");

-- CreateIndex
CREATE INDEX "games_slug_idx" ON "games"("slug");

-- CreateIndex
CREATE INDEX "games_category_idx" ON "games"("category");

-- CreateIndex
CREATE UNIQUE INDEX "games_provider_id_external_game_id_key" ON "games"("provider_id", "external_game_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_sessions_session_token_key" ON "game_sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_provider_id_external_round_id_key" ON "game_rounds"("provider_id", "external_round_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_transactions_ledger_entry_id_key" ON "game_transactions"("ledger_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_transactions_provider_id_external_transaction_id_key" ON "game_transactions"("provider_id", "external_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_favorites_user_id_game_id_key" ON "game_favorites"("user_id", "game_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_providers" ADD CONSTRAINT "auth_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kyc_profile_id_fkey" FOREIGN KEY ("kyc_profile_id") REFERENCES "kyc_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_account_id_fkey" FOREIGN KEY ("wallet_account_id") REFERENCES "wallet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_callbacks" ADD CONSTRAINT "payment_callbacks_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "game_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "game_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "game_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_transactions" ADD CONSTRAINT "game_transactions_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_transactions" ADD CONSTRAINT "game_transactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_transactions" ADD CONSTRAINT "game_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_transactions" ADD CONSTRAINT "game_transactions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "game_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_transactions" ADD CONSTRAINT "game_transactions_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_favorites" ADD CONSTRAINT "game_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_favorites" ADD CONSTRAINT "game_favorites_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

