-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('active', 'suspended', 'rejected');

-- CreateEnum
CREATE TYPE "AffiliateAttributionStatus" AS ENUM ('pending', 'qualified', 'rejected');

-- CreateEnum
CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('pending', 'approved', 'paid', 'cancelled');

-- CreateTable
CREATE TABLE "affiliates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'active',
    "tracking_code" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(128),
    "country" VARCHAR(2),
    "telegram" VARCHAR(64),
    "website" TEXT,
    "traffic_sources" JSONB NOT NULL DEFAULT '[]',
    "revshare_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.2000,
    "payout_currency" VARCHAR(16) NOT NULL DEFAULT 'RUB',
    "total_earned" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "total_paid" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "is_agreed" BOOLEAN NOT NULL DEFAULT false,
    "agreed_at" TIMESTAMPTZ,
    "suspended_reason" TEXT,
    "last_click_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_clicks" (
    "id" BIGSERIAL NOT NULL,
    "affiliate_id" UUID NOT NULL,
    "landing_path" VARCHAR(255) NOT NULL,
    "ip_hash" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(255),
    "referer_host" VARCHAR(255),
    "geo_country" VARCHAR(2),
    "campaign_id" VARCHAR(64),
    "sub_id" VARCHAR(64),
    "is_converted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_attributions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "affiliate_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "click_id" BIGINT,
    "status" "AffiliateAttributionStatus" NOT NULL DEFAULT 'pending',
    "qualified_at" TIMESTAMPTZ,
    "first_deposit_id" UUID,
    "first_deposit_at" TIMESTAMPTZ,
    "total_deposit" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "deposit_count" INTEGER NOT NULL DEFAULT 0,
    "is_self_referral" BOOLEAN NOT NULL DEFAULT false,
    "reject_reason" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "affiliate_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "attribution_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "bet_sum" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "win_sum" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "rollback_sum" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "bonus_sum" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "provider_fee_sum" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "ggr_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "ngr_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "revshare_rate" DECIMAL(5,4) NOT NULL,
    "commission_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "status" "AffiliateCommissionStatus" NOT NULL DEFAULT 'pending',
    "credited_at" TIMESTAMPTZ,
    "ledger_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_user_id_key" ON "affiliates"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_email_key" ON "affiliates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_tracking_code_key" ON "affiliates"("tracking_code");

-- CreateIndex
CREATE INDEX "affiliates_status_idx" ON "affiliates"("status");

-- CreateIndex
CREATE INDEX "affiliates_created_at_idx" ON "affiliates"("created_at");

-- CreateIndex
CREATE INDEX "affiliate_clicks_affiliate_id_created_at_idx" ON "affiliate_clicks"("affiliate_id", "created_at");

-- CreateIndex
CREATE INDEX "affiliate_clicks_created_at_idx" ON "affiliate_clicks"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_attributions_player_id_key" ON "affiliate_attributions"("player_id");

-- CreateIndex
CREATE INDEX "affiliate_attributions_affiliate_id_status_idx" ON "affiliate_attributions"("affiliate_id", "status");

-- CreateIndex
CREATE INDEX "affiliate_attributions_affiliate_id_first_deposit_at_idx" ON "affiliate_attributions"("affiliate_id", "first_deposit_at");

-- CreateIndex
CREATE INDEX "affiliate_commissions_affiliate_id_period_start_idx" ON "affiliate_commissions"("affiliate_id", "period_start");

-- CreateIndex
CREATE INDEX "affiliate_commissions_status_idx" ON "affiliate_commissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_commissions_affiliate_id_player_id_period_start_c_key" ON "affiliate_commissions"("affiliate_id", "player_id", "period_start", "currency");

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_attribution_id_fkey" FOREIGN KEY ("attribution_id") REFERENCES "affiliate_attributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
