CREATE TABLE "google_oauth_flows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state_hash" TEXT NOT NULL,
    "pending_token_hash" TEXT,
    "provider_subject" VARCHAR(255),
    "provider_email" CITEXT,
    "first_name" VARCHAR(80),
    "last_name" VARCHAR(80),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "state_consumed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_oauth_flows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_oauth_flows_state_hash_key" ON "google_oauth_flows"("state_hash");
CREATE UNIQUE INDEX "google_oauth_flows_pending_token_hash_key" ON "google_oauth_flows"("pending_token_hash");
CREATE INDEX "idx_google_oauth_flows_expires" ON "google_oauth_flows"("expires_at");
