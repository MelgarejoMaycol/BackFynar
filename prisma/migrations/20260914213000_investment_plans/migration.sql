-- Investment plans are intentionally separate from financial_accounts.
-- A plan can exist without moving money. Contributions/withdrawals are explicit,
-- user-triggered cash flows and never recurring obligations.

CREATE TYPE "public"."investment_plan_status" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED'
);

CREATE TYPE "public"."investment_contribution_frequency" AS ENUM (
  'NONE',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY'
);

CREATE TABLE "public"."investment_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(140) NOT NULL,
  "description" TEXT,
  "currency" CHAR(3) NOT NULL DEFAULT 'COP',
  "status" "public"."investment_plan_status" NOT NULL DEFAULT 'DRAFT',
  "planned_initial_amount" DECIMAL(18,2) NOT NULL,
  "recurring_contribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "contribution_frequency" "public"."investment_contribution_frequency" NOT NULL DEFAULT 'MONTHLY',
  "horizon_years" INTEGER NOT NULL,
  "annual_return" DECIMAL(10,7) NOT NULL,
  "annual_fee" DECIMAL(10,7) NOT NULL DEFAULT 0,
  "inflation_rate" DECIMAL(10,7) NOT NULL DEFAULT 0,
  "start_date" DATE,
  "include_in_net_worth" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paused_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "investment_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "investment_plans_amount_check" CHECK ("planned_initial_amount" > 0 AND "recurring_contribution" >= 0),
  CONSTRAINT "investment_plans_horizon_check" CHECK ("horizon_years" BETWEEN 1 AND 50),
  CONSTRAINT "investment_plans_rates_check" CHECK (
    "annual_return" > -1 AND "annual_return" <= 3
    AND "annual_fee" >= 0 AND "annual_fee" < 1
    AND "inflation_rate" >= 0 AND "inflation_rate" <= 1
  )
);

CREATE UNIQUE INDEX "investment_plans_workspace_id_id_key"
  ON "public"."investment_plans"("workspace_id", "id");

CREATE INDEX "idx_investment_plans_workspace_status"
  ON "public"."investment_plans"("workspace_id", "status", "created_at" DESC);

CREATE TABLE "public"."investment_contributions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "source_account_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "note" VARCHAR(500),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "investment_contributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "investment_contributions_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "investment_contributions_workspace_id_id_key"
  ON "public"."investment_contributions"("workspace_id", "id");
CREATE UNIQUE INDEX "investment_contributions_transaction_id_key"
  ON "public"."investment_contributions"("transaction_id");
CREATE UNIQUE INDEX "investment_contributions_workspace_id_transaction_id_key"
  ON "public"."investment_contributions"("workspace_id", "transaction_id");
CREATE INDEX "idx_investment_contributions_plan"
  ON "public"."investment_contributions"("workspace_id", "plan_id", "occurred_at" DESC);

CREATE TABLE "public"."investment_withdrawals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "destination_account_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "note" VARCHAR(500),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "investment_withdrawals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "investment_withdrawals_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "investment_withdrawals_workspace_id_id_key"
  ON "public"."investment_withdrawals"("workspace_id", "id");
CREATE UNIQUE INDEX "investment_withdrawals_transaction_id_key"
  ON "public"."investment_withdrawals"("transaction_id");
CREATE UNIQUE INDEX "investment_withdrawals_workspace_id_transaction_id_key"
  ON "public"."investment_withdrawals"("workspace_id", "transaction_id");
CREATE INDEX "idx_investment_withdrawals_plan"
  ON "public"."investment_withdrawals"("workspace_id", "plan_id", "occurred_at" DESC);

CREATE TABLE "public"."investment_valuations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "value" DECIMAL(18,2) NOT NULL,
  "captured_at" TIMESTAMPTZ(6) NOT NULL,
  "note" VARCHAR(500),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "investment_valuations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "investment_valuations_value_check" CHECK ("value" >= 0)
);

CREATE UNIQUE INDEX "investment_valuations_workspace_id_id_key"
  ON "public"."investment_valuations"("workspace_id", "id");
CREATE INDEX "idx_investment_valuations_plan"
  ON "public"."investment_valuations"("workspace_id", "plan_id", "captured_at" DESC);

ALTER TABLE "public"."investment_plans"
  ADD CONSTRAINT "investment_plans_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."investment_plans"
  ADD CONSTRAINT "investment_plans_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."investment_contributions"
  ADD CONSTRAINT "investment_contributions_workspace_plan_fkey"
  FOREIGN KEY ("workspace_id", "plan_id") REFERENCES "public"."investment_plans"("workspace_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_contributions"
  ADD CONSTRAINT "investment_contributions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_contributions"
  ADD CONSTRAINT "investment_contributions_source_account_fkey"
  FOREIGN KEY ("workspace_id", "source_account_id") REFERENCES "public"."financial_accounts"("workspace_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_contributions"
  ADD CONSTRAINT "investment_contributions_transaction_fkey"
  FOREIGN KEY ("workspace_id", "transaction_id") REFERENCES "public"."transactions"("workspace_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_contributions"
  ADD CONSTRAINT "investment_contributions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."investment_withdrawals"
  ADD CONSTRAINT "investment_withdrawals_workspace_plan_fkey"
  FOREIGN KEY ("workspace_id", "plan_id") REFERENCES "public"."investment_plans"("workspace_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_withdrawals"
  ADD CONSTRAINT "investment_withdrawals_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_withdrawals"
  ADD CONSTRAINT "investment_withdrawals_destination_account_fkey"
  FOREIGN KEY ("workspace_id", "destination_account_id") REFERENCES "public"."financial_accounts"("workspace_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_withdrawals"
  ADD CONSTRAINT "investment_withdrawals_transaction_fkey"
  FOREIGN KEY ("workspace_id", "transaction_id") REFERENCES "public"."transactions"("workspace_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_withdrawals"
  ADD CONSTRAINT "investment_withdrawals_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."investment_valuations"
  ADD CONSTRAINT "investment_valuations_workspace_plan_fkey"
  FOREIGN KEY ("workspace_id", "plan_id") REFERENCES "public"."investment_plans"("workspace_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_valuations"
  ADD CONSTRAINT "investment_valuations_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."investment_valuations"
  ADD CONSTRAINT "investment_valuations_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
