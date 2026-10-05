-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('terms', 'privacy', 'cookies', 'responsible_gaming');

-- CreateTable
CREATE TABLE "terms_acceptances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "document" "LegalDocumentType" NOT NULL,
    "version" VARCHAR(16) NOT NULL,
    "ip_hash" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(255),
    "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terms_acceptances_user_id_accepted_at_idx" ON "terms_acceptances"("user_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "terms_acceptances_user_id_document_version_key" ON "terms_acceptances"("user_id", "document", "version");

-- AddForeignKey
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

