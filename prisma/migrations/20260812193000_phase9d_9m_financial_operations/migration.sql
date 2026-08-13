CREATE TYPE "public"."obligation_amount_type" AS ENUM ('FIXED', 'VARIABLE');
CREATE TYPE "public"."card_statement_status" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'CLOSED');

ALTER TABLE "public"."debt_payments"
  ADD COLUMN "idempotency_key" VARCHAR(100),
  ADD COLUMN "reversed_at" TIMESTAMPTZ(6),
  ADD COLUMN "reversed_by" UUID;
UPDATE "public"."debt_payments" SET "idempotency_key" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL;
ALTER TABLE "public"."debt_payments" ALTER COLUMN "idempotency_key" SET NOT NULL;
CREATE UNIQUE INDEX "debt_payments_workspace_id_idempotency_key_key"
  ON "public"."debt_payments"("workspace_id", "idempotency_key");

ALTER TABLE "public"."recurring_obligations"
  ADD COLUMN "amount_type" "public"."obligation_amount_type" NOT NULL DEFAULT 'FIXED';

CREATE TABLE "public"."debt_reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "debt_id" UUID NOT NULL,
  "calculated_balance" DECIMAL(18,2) NOT NULL, "reported_balance" DECIMAL(18,2) NOT NULL,
  "difference" DECIMAL(18,2) NOT NULL, "previous_rate" DECIMAL(10,7), "new_rate" DECIMAL(10,7),
  "previous_payment" DECIMAL(18,2), "new_payment" DECIMAL(18,2), "effective_date" DATE NOT NULL,
  "source" VARCHAR(100) NOT NULL, "notes" TEXT, "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "debt_reconciliations_debt_fkey" FOREIGN KEY ("workspace_id", "debt_id")
    REFERENCES "public"."debts"("workspace_id", "id") ON DELETE CASCADE
);
CREATE INDEX "debt_reconciliations_workspace_id_debt_id_effective_date_idx"
  ON "public"."debt_reconciliations"("workspace_id", "debt_id", "effective_date" DESC);

CREATE TABLE "public"."obligation_occurrences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "obligation_id" UUID NOT NULL,
  "due_date" DATE NOT NULL, "amount" DECIMAL(18,2) NOT NULL, "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" "public"."installment_status" NOT NULL DEFAULT 'PENDING', "payment_account_id" UUID,
  "transaction_id" UUID, "paid_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "obligation_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "obligation_occurrences_amount_check" CHECK (amount > 0 AND paid_amount >= 0 AND paid_amount <= amount),
  CONSTRAINT "obligation_occurrences_obligation_fkey" FOREIGN KEY ("workspace_id", "obligation_id")
    REFERENCES "public"."recurring_obligations"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "obligation_occurrences_account_fkey" FOREIGN KEY ("workspace_id", "payment_account_id")
    REFERENCES "public"."financial_accounts"("workspace_id", "id"),
  CONSTRAINT "obligation_occurrences_transaction_fkey" FOREIGN KEY ("workspace_id", "transaction_id")
    REFERENCES "public"."transactions"("workspace_id", "id")
);
CREATE UNIQUE INDEX "obligation_occurrences_workspace_obligation_due_key" ON "public"."obligation_occurrences"("workspace_id", "obligation_id", "due_date");
CREATE UNIQUE INDEX "obligation_occurrences_transaction_id_key" ON "public"."obligation_occurrences"("transaction_id");
CREATE UNIQUE INDEX "obligation_occurrences_workspace_transaction_key" ON "public"."obligation_occurrences"("workspace_id", "transaction_id");
CREATE INDEX "obligation_occurrences_workspace_status_due_idx" ON "public"."obligation_occurrences"("workspace_id", "status", "due_date");

CREATE TABLE "public"."card_purchases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "card_account_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL, "installment_count" INTEGER NOT NULL DEFAULT 1,
  "periodic_rate" DECIMAL(10,7) NOT NULL DEFAULT 0, "outstanding_balance" DECIMAL(18,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_purchases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_purchases_values_check" CHECK (installment_count > 0 AND periodic_rate >= 0 AND outstanding_balance >= 0),
  CONSTRAINT "card_purchases_account_fkey" FOREIGN KEY ("workspace_id", "card_account_id") REFERENCES "public"."financial_accounts"("workspace_id", "id"),
  CONSTRAINT "card_purchases_transaction_fkey" FOREIGN KEY ("workspace_id", "transaction_id") REFERENCES "public"."transactions"("workspace_id", "id")
);
CREATE UNIQUE INDEX "card_purchases_workspace_id_id_key" ON "public"."card_purchases"("workspace_id", "id");
CREATE UNIQUE INDEX "card_purchases_transaction_id_key" ON "public"."card_purchases"("transaction_id");
CREATE UNIQUE INDEX "card_purchases_workspace_transaction_key" ON "public"."card_purchases"("workspace_id", "transaction_id");
CREATE INDEX "card_purchases_workspace_card_idx" ON "public"."card_purchases"("workspace_id", "card_account_id");

CREATE TABLE "public"."card_purchase_installments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "card_purchase_id" UUID NOT NULL,
  "installment_number" INTEGER NOT NULL, "due_date" DATE NOT NULL, "principal_amount" DECIMAL(18,2) NOT NULL,
  "interest_amount" DECIMAL(18,2) NOT NULL DEFAULT 0, "total_amount" DECIMAL(18,2) NOT NULL,
  "status" "public"."installment_status" NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "card_purchase_installments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_purchase_installments_amount_check" CHECK (installment_number > 0 AND principal_amount >= 0 AND interest_amount >= 0 AND total_amount > 0),
  CONSTRAINT "card_purchase_installments_purchase_fkey" FOREIGN KEY ("workspace_id", "card_purchase_id") REFERENCES "public"."card_purchases"("workspace_id", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "card_purchase_installments_purchase_number_key" ON "public"."card_purchase_installments"("card_purchase_id", "installment_number");

CREATE TABLE "public"."card_statements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "card_account_id" UUID NOT NULL,
  "period_start" DATE NOT NULL, "period_end" DATE NOT NULL, "due_date" DATE NOT NULL,
  "previous_balance" DECIMAL(18,2) NOT NULL DEFAULT 0, "purchases_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "payments_amount" DECIMAL(18,2) NOT NULL DEFAULT 0, "interest_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0, "calculated_balance" DECIMAL(18,2) NOT NULL,
  "reported_balance" DECIMAL(18,2), "minimum_payment" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0, "status" "public"."card_statement_status" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_statements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_statements_dates_check" CHECK (period_start <= period_end AND period_end <= due_date),
  CONSTRAINT "card_statements_amount_check" CHECK (minimum_payment >= 0 AND paid_amount >= 0),
  CONSTRAINT "card_statements_account_fkey" FOREIGN KEY ("workspace_id", "card_account_id") REFERENCES "public"."financial_accounts"("workspace_id", "id")
);
CREATE UNIQUE INDEX "card_statements_workspace_card_period_key" ON "public"."card_statements"("workspace_id", "card_account_id", "period_start", "period_end");
CREATE INDEX "card_statements_workspace_status_due_idx" ON "public"."card_statements"("workspace_id", "status", "due_date");
