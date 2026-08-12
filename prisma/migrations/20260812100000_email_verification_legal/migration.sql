-- AlterTable
ALTER TABLE "users"
ADD COLUMN "terms_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN "privacy_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN "legal_version" VARCHAR(40);

-- Existing accounts predate explicit legal-version tracking. New registrations
-- are required by the API to populate these fields.

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "request_ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key"
ON "email_verification_tokens"("token_hash");
CREATE INDEX "idx_email_verification_user_active"
ON "email_verification_tokens"("user_id", "revoked_at", "consumed_at");
CREATE INDEX "idx_email_verification_expires"
ON "email_verification_tokens"("expires_at");
ALTER TABLE "email_verification_tokens"
ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
