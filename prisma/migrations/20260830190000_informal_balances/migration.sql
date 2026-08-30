CREATE TABLE "informal_balances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "direction" VARCHAR(16) NOT NULL,
  "counterparty_name" VARCHAR(150) NOT NULL,
  "description" VARCHAR(220) NOT NULL,
  "original_amount" DECIMAL(18,2) NOT NULL,
  "current_balance" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'COP',
  "occurred_on" DATE NOT NULL,
  "due_on" DATE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "informal_balances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "informal_balances_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "informal_balances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "informal_balances_direction_check" CHECK ("direction" IN ('PAYABLE','RECEIVABLE')),
  CONSTRAINT "informal_balances_status_check" CHECK ("status" IN ('OPEN','PARTIAL','SETTLED','CANCELLED')),
  CONSTRAINT "informal_balances_original_amount_check" CHECK ("original_amount" > 0),
  CONSTRAINT "informal_balances_current_balance_check" CHECK ("current_balance" >= 0 AND "current_balance" <= "original_amount"),
  CONSTRAINT "informal_balances_counterparty_check" CHECK (length(btrim("counterparty_name")) > 0),
  CONSTRAINT "informal_balances_description_check" CHECK (length(btrim("description")) > 0)
);

CREATE INDEX "idx_informal_balances_workspace_status_due"
  ON "informal_balances" ("workspace_id", "status", "due_on");
CREATE INDEX "idx_informal_balances_workspace_counterparty"
  ON "informal_balances" ("workspace_id", lower("counterparty_name"));

CREATE TABLE "informal_balance_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "informal_balance_id" UUID NOT NULL,
  "transaction_id" UUID,
  "account_id" UUID,
  "amount" DECIMAL(18,2) NOT NULL,
  "paid_at" TIMESTAMPTZ(6) NOT NULL,
  "notes" TEXT,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "created_by" UUID NOT NULL,
  "reversed_at" TIMESTAMPTZ(6),
  "reversed_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "informal_balance_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "informal_balance_payments_balance_fkey" FOREIGN KEY ("informal_balance_id") REFERENCES "informal_balances"("id") ON DELETE CASCADE,
  CONSTRAINT "informal_balance_payments_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "informal_balance_payments_transaction_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL,
  CONSTRAINT "informal_balance_payments_account_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL,
  CONSTRAINT "informal_balance_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "informal_balance_payments_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "informal_balance_payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "informal_balance_payments_workspace_balance_unique" UNIQUE ("workspace_id", "informal_balance_id", "id"),
  CONSTRAINT "informal_balance_payments_idempotency_unique" UNIQUE ("workspace_id", "idempotency_key")
);

CREATE INDEX "idx_informal_balance_payments_balance_paid"
  ON "informal_balance_payments" ("workspace_id", "informal_balance_id", "paid_at" DESC);
