-- Phase 9A: credits, installments, payments and recurring obligations.
-- This migration is incremental: existing debt data is retained and backfilled.

CREATE TYPE "public"."interest_rate_basis" AS ENUM (
  'EFFECTIVE_ANNUAL',
  'NOMINAL_ANNUAL',
  'EFFECTIVE_MONTHLY',
  'NOMINAL_MONTHLY'
);

CREATE TYPE "public"."obligation_status" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED'
);

ALTER TYPE "public"."debt_type" ADD VALUE IF NOT EXISTS 'PURCHASE_FINANCING';
ALTER TYPE "public"."debt_type" ADD VALUE IF NOT EXISTS 'INFORMAL_LOAN';
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'DEBT_INSTALLMENT_DUE';
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'RECURRING_OBLIGATION';

ALTER TABLE "public"."debts"
  RENAME COLUMN "annual_interest_rate" TO "interest_rate";
ALTER TABLE "public"."debts"
  ALTER COLUMN "interest_rate" TYPE DECIMAL(10,7),
  ADD COLUMN "interest_rate_basis" "public"."interest_rate_basis" NOT NULL DEFAULT 'EFFECTIVE_ANNUAL',
  ADD COLUMN "next_due_date" DATE;

ALTER TABLE "public"."debts"
  DROP CONSTRAINT IF EXISTS "debts_annual_interest_rate_check";
ALTER TABLE "public"."debts"
  ADD CONSTRAINT "debts_interest_rate_check" CHECK ("interest_rate" >= 0),
  ADD CONSTRAINT "debts_interest_none_rate_check" CHECK ("interest_type" <> 'NONE' OR "interest_rate" = 0),
  ADD CONSTRAINT "debts_date_order_check" CHECK (
    ("first_payment_date" IS NULL OR "disbursement_date" IS NULL OR "first_payment_date" >= "disbursement_date")
    AND ("next_due_date" IS NULL OR "disbursement_date" IS NULL OR "next_due_date" >= "disbursement_date")
    AND ("estimated_end_date" IS NULL OR "disbursement_date" IS NULL OR "estimated_end_date" >= "disbursement_date")
  );

ALTER TABLE "public"."debt_installments" ADD COLUMN "workspace_id" UUID;
ALTER TABLE "public"."debt_payments" ADD COLUMN "workspace_id" UUID;

UPDATE "public"."debt_installments" i
SET "workspace_id" = d."workspace_id"
FROM "public"."debts" d
WHERE d."id" = i."debt_id";

UPDATE "public"."debt_payments" p
SET "workspace_id" = d."workspace_id"
FROM "public"."debts" d
WHERE d."id" = p."debt_id";

ALTER TABLE "public"."debt_installments" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "public"."debt_payments" ALTER COLUMN "workspace_id" SET NOT NULL;

CREATE UNIQUE INDEX "financial_accounts_workspace_id_id_key"
  ON "public"."financial_accounts"("workspace_id", "id");
CREATE UNIQUE INDEX "debts_workspace_id_id_key"
  ON "public"."debts"("workspace_id", "id");
CREATE UNIQUE INDEX "debt_installments_workspace_id_debt_id_id_key"
  ON "public"."debt_installments"("workspace_id", "debt_id", "id");
CREATE UNIQUE INDEX "debt_payments_workspace_id_transaction_id_key"
  ON "public"."debt_payments"("workspace_id", "transaction_id");
CREATE UNIQUE INDEX "recurrence_rules_workspace_id_id_key"
  ON "public"."recurrence_rules"("workspace_id", "id");
CREATE UNIQUE INDEX "transactions_workspace_id_id_key"
  ON "public"."transactions"("workspace_id", "id");

ALTER TABLE "public"."debt_installments"
  DROP CONSTRAINT "debt_installments_debt_id_fkey";
ALTER TABLE "public"."debt_payments"
  DROP CONSTRAINT "debt_payments_debt_id_fkey",
  DROP CONSTRAINT "debt_payments_installment_id_fkey",
  DROP CONSTRAINT "debt_payments_transaction_id_fkey";
ALTER TABLE "public"."debts"
  DROP CONSTRAINT "debts_liability_account_id_fkey";
ALTER TABLE "public"."financial_events"
  DROP CONSTRAINT "financial_events_recurrence_rule_id_fkey",
  DROP CONSTRAINT "financial_events_related_debt_id_fkey";

ALTER TABLE "public"."debt_installments"
  ADD CONSTRAINT "debt_installments_workspace_debt_fkey"
  FOREIGN KEY ("workspace_id", "debt_id")
  REFERENCES "public"."debts"("workspace_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."debt_payments"
  ADD CONSTRAINT "debt_payments_workspace_debt_fkey"
    FOREIGN KEY ("workspace_id", "debt_id")
    REFERENCES "public"."debts"("workspace_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "debt_payments_workspace_installment_fkey"
    FOREIGN KEY ("workspace_id", "debt_id", "installment_id")
    REFERENCES "public"."debt_installments"("workspace_id", "debt_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "debt_payments_workspace_transaction_fkey"
    FOREIGN KEY ("workspace_id", "transaction_id")
    REFERENCES "public"."transactions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."debts"
  ADD CONSTRAINT "debts_workspace_liability_account_fkey"
  FOREIGN KEY ("workspace_id", "liability_account_id")
  REFERENCES "public"."financial_accounts"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."debt_installments"
  ADD CONSTRAINT "debt_installments_paid_not_over_total_check"
  CHECK ("paid_amount" <= "total_amount");

ALTER TABLE "public"."financial_events"
  ADD COLUMN "related_debt_installment_id" UUID,
  ADD COLUMN "related_obligation_id" UUID;

CREATE TABLE "public"."recurring_obligations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "recurrence_rule_id" UUID NOT NULL,
  "payment_account_id" UUID,
  "category_id" UUID,
  "name" VARCHAR(150) NOT NULL,
  "description" TEXT,
  "expected_amount" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'COP',
  "status" "public"."obligation_status" NOT NULL DEFAULT 'ACTIVE',
  "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "recurring_obligations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_obligations_expected_amount_check" CHECK ("expected_amount" > 0),
  CONSTRAINT "recurring_obligations_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "recurring_obligations_recurrence_rule_id_key"
  ON "public"."recurring_obligations"("recurrence_rule_id");
CREATE UNIQUE INDEX "recurring_obligations_workspace_id_id_key"
  ON "public"."recurring_obligations"("workspace_id", "id");
CREATE UNIQUE INDEX "recurring_obligations_workspace_id_recurrence_rule_id_key"
  ON "public"."recurring_obligations"("workspace_id", "recurrence_rule_id");
CREATE INDEX "idx_obligations_workspace_status"
  ON "public"."recurring_obligations"("workspace_id", "status");

ALTER TABLE "public"."recurring_obligations"
  ADD CONSTRAINT "recurring_obligations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "recurring_obligations_workspace_recurrence_fkey"
    FOREIGN KEY ("workspace_id", "recurrence_rule_id")
    REFERENCES "public"."recurrence_rules"("workspace_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "recurring_obligations_workspace_account_fkey"
    FOREIGN KEY ("workspace_id", "payment_account_id")
    REFERENCES "public"."financial_accounts"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "recurring_obligations_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."financial_events"
  ADD CONSTRAINT "financial_events_workspace_recurrence_fkey"
    FOREIGN KEY ("workspace_id", "recurrence_rule_id")
    REFERENCES "public"."recurrence_rules"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "financial_events_workspace_debt_fkey"
    FOREIGN KEY ("workspace_id", "related_debt_id")
    REFERENCES "public"."debts"("workspace_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "financial_events_workspace_installment_fkey"
    FOREIGN KEY ("workspace_id", "related_debt_id", "related_debt_installment_id")
    REFERENCES "public"."debt_installments"("workspace_id", "debt_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "financial_events_workspace_obligation_fkey"
    FOREIGN KEY ("workspace_id", "related_obligation_id")
    REFERENCES "public"."recurring_obligations"("workspace_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

DROP INDEX "public"."idx_installments_due_status";
CREATE INDEX "idx_installments_workspace_status_due"
  ON "public"."debt_installments"("workspace_id", "status", "due_date");
CREATE INDEX "idx_debt_payments_workspace_debt_paid"
  ON "public"."debt_payments"("workspace_id", "debt_id", "paid_at" DESC);
CREATE INDEX "idx_debt_payments_workspace_installment"
  ON "public"."debt_payments"("workspace_id", "installment_id");
CREATE INDEX "idx_debts_workspace_status_due"
  ON "public"."debts"("workspace_id", "status", "next_due_date");

CREATE OR REPLACE FUNCTION "public"."set_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_recurring_obligations_updated_at"
BEFORE UPDATE ON "public"."recurring_obligations"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
