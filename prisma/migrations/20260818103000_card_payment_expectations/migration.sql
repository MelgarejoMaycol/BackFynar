CREATE TABLE "public"."card_payment_expectations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "card_account_id" UUID NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "due_date" DATE NOT NULL,
  "minimum_payment" DECIMAL(18,2),
  "reported_total_balance" DECIMAL(18,2),
  "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" "public"."installment_status" NOT NULL DEFAULT 'PENDING',
  "created_by" UUID NOT NULL,
  "superseded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_payment_expectations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_payment_expectations_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "card_payment_expectations_paid_check" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "amount")
);

CREATE UNIQUE INDEX "card_payment_expectations_workspace_id_id_key"
  ON "public"."card_payment_expectations"("workspace_id", "id");
CREATE INDEX "idx_card_payment_expectations_active"
  ON "public"."card_payment_expectations"("workspace_id", "card_account_id", "status", "due_date");

ALTER TABLE "public"."card_payment_expectations"
  ADD CONSTRAINT "card_payment_expectations_card_account_fkey"
  FOREIGN KEY ("workspace_id", "card_account_id") REFERENCES "public"."financial_accounts"("workspace_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."card_payment_expectations"
  ADD CONSTRAINT "card_payment_expectations_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
