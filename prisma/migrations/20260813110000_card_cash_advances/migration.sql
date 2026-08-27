CREATE TABLE "public"."card_cash_advances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "card_account_id" UUID NOT NULL,
  "destination_account_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "periodic_rate" DECIMAL(10,7),
  "installment_count" INTEGER,
  "notes" TEXT,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_cash_advances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_cash_advances_values_check" CHECK (
    amount > 0 AND fee_amount >= 0 AND (periodic_rate IS NULL OR periodic_rate >= 0)
    AND (installment_count IS NULL OR installment_count > 0)
  ),
  CONSTRAINT "card_cash_advances_card_fkey" FOREIGN KEY ("workspace_id", "card_account_id")
    REFERENCES "public"."financial_accounts"("workspace_id", "id"),
  CONSTRAINT "card_cash_advances_destination_fkey" FOREIGN KEY ("workspace_id", "destination_account_id")
    REFERENCES "public"."financial_accounts"("workspace_id", "id"),
  CONSTRAINT "card_cash_advances_transaction_fkey" FOREIGN KEY ("workspace_id", "transaction_id")
    REFERENCES "public"."transactions"("workspace_id", "id")
);
CREATE UNIQUE INDEX "card_cash_advances_workspace_id_id_key" ON "public"."card_cash_advances"("workspace_id", "id");
CREATE UNIQUE INDEX "card_cash_advances_transaction_id_key" ON "public"."card_cash_advances"("transaction_id");
CREATE UNIQUE INDEX "card_cash_advances_workspace_transaction_key" ON "public"."card_cash_advances"("workspace_id", "transaction_id");
CREATE INDEX "card_cash_advances_workspace_card_occurred_idx" ON "public"."card_cash_advances"("workspace_id", "card_account_id", "occurred_at" DESC);
