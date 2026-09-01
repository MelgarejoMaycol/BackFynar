CREATE TABLE "obligation_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "note" VARCHAR(500),
    "reversed_at" TIMESTAMPTZ(6),
    "reversed_by" UUID,
    "reversal_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "obligation_payments_transaction_id_key"
ON "obligation_payments"("transaction_id");

CREATE UNIQUE INDEX "obligation_payments_workspace_id_id_key"
ON "obligation_payments"("workspace_id", "id");

CREATE UNIQUE INDEX "obligation_payments_workspace_id_transaction_id_key"
ON "obligation_payments"("workspace_id", "transaction_id");

CREATE INDEX "obligation_payments_workspace_id_occurrence_id_reversed_at_idx"
ON "obligation_payments"("workspace_id", "occurrence_id", "reversed_at");

ALTER TABLE "obligation_payments"
ADD CONSTRAINT "obligation_payments_workspace_id_occurrence_id_fkey"
FOREIGN KEY ("workspace_id", "occurrence_id")
REFERENCES "obligation_occurrences"("workspace_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "obligation_payments"
ADD CONSTRAINT "obligation_payments_workspace_id_account_id_fkey"
FOREIGN KEY ("workspace_id", "account_id")
REFERENCES "financial_accounts"("workspace_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "obligation_payments"
ADD CONSTRAINT "obligation_payments_workspace_id_transaction_id_fkey"
FOREIGN KEY ("workspace_id", "transaction_id")
REFERENCES "transactions"("workspace_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the currently representable historical payment before switching the
-- application to the normalized payment ledger. Inconsistent legacy rows are
-- intentionally not guessed; they remain visible for a later reconciliation.
INSERT INTO "obligation_payments" (
    "workspace_id", "occurrence_id", "account_id", "transaction_id",
    "amount", "paid_at", "created_at", "updated_at"
)
SELECT
    occurrence."workspace_id",
    occurrence."id",
    occurrence."payment_account_id",
    occurrence."transaction_id",
    transaction."amount",
    COALESCE(occurrence."paid_at", transaction."occurred_at"),
    transaction."created_at",
    transaction."updated_at"
FROM "obligation_occurrences" occurrence
JOIN "transactions" transaction
  ON transaction."workspace_id" = occurrence."workspace_id"
 AND transaction."id" = occurrence."transaction_id"
WHERE occurrence."payment_account_id" IS NOT NULL
  AND occurrence."transaction_id" IS NOT NULL
  AND transaction."status" = 'CONFIRMED'
  AND transaction."deleted_at" IS NULL
ON CONFLICT ("transaction_id") DO NOTHING;
