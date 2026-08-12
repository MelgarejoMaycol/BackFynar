ALTER TABLE "user_preferences" ALTER COLUMN "theme" SET DEFAULT 'LIGHT';

CREATE TABLE "pending_registrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "email" CITEXT NOT NULL,
  "password_hash" TEXT NOT NULL, "first_name" VARCHAR(80) NOT NULL,
  "last_name" VARCHAR(80), "terms_accepted_at" TIMESTAMPTZ(6) NOT NULL,
  "privacy_accepted_at" TIMESTAMPTZ(6) NOT NULL, "legal_version" VARCHAR(40) NOT NULL,
  "verification_token_hash" TEXT NOT NULL, "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "email_sent_at" TIMESTAMPTZ(6), "consumed_at" TIMESTAMPTZ(6), "revoked_at" TIMESTAMPTZ(6),
  "request_ip_address" INET, "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pending_registrations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pending_registrations_email_key" ON "pending_registrations"("email");
CREATE UNIQUE INDEX "pending_registrations_verification_token_hash_key" ON "pending_registrations"("verification_token_hash");
CREATE INDEX "idx_pending_registrations_expires" ON "pending_registrations"("expires_at");

CREATE TABLE "email_change_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL,
  "new_email" CITEXT NOT NULL, "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL, "email_sent_at" TIMESTAMPTZ(6),
  "consumed_at" TIMESTAMPTZ(6), "revoked_at" TIMESTAMPTZ(6),
  "request_ip_address" INET, "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_change_requests_token_hash_key" ON "email_change_requests"("token_hash");
CREATE INDEX "idx_email_change_user_active" ON "email_change_requests"("user_id", "revoked_at", "consumed_at");
CREATE INDEX "idx_email_change_expires" ON "email_change_requests"("expires_at");
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
