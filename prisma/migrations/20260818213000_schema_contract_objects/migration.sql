CREATE INDEX IF NOT EXISTS "idx_accounts_workspace_active" ON "public"."financial_accounts" ("workspace_id", "is_active") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_categories_workspace_type" ON "public"."categories" ("workspace_id", "type") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_transactions_workspace_date" ON "public"."transactions" ("workspace_id", "occurred_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_transactions_account_date" ON "public"."transactions" ("account_id", "occurred_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_transactions_destination_date" ON "public"."transactions" ("destination_account_id", "occurred_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_transactions_category_date" ON "public"."transactions" ("category_id", "occurred_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_transactions_search" ON "public"."transactions" USING GIN (to_tsvector('simple', COALESCE("description", '') || ' ' || COALESCE("merchant_name", '')));
CREATE INDEX IF NOT EXISTS "idx_budgets_workspace_period" ON "public"."budgets" ("workspace_id", "starts_on", "ends_on") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_debts_workspace_status" ON "public"."debts" ("workspace_id", "status") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_goals_workspace_status" ON "public"."savings_goals" ("workspace_id", "status") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread" ON "public"."notifications" ("user_id", "read_at", "created_at" DESC) WHERE "read_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_outbox_unprocessed" ON "public"."outbox_events" ("processed_at", "occurred_at") WHERE "processed_at" IS NULL;

CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END $$;

CREATE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_workspaces_updated_at" BEFORE UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_user_preferences_updated_at" BEFORE UPDATE ON "public"."user_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_accounts_updated_at" BEFORE UPDATE ON "public"."financial_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_categories_updated_at" BEFORE UPDATE ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_recurrence_rules_updated_at" BEFORE UPDATE ON "public"."recurrence_rules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_transactions_updated_at" BEFORE UPDATE ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_budgets_updated_at" BEFORE UPDATE ON "public"."budgets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_debts_updated_at" BEFORE UPDATE ON "public"."debts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_installments_updated_at" BEFORE UPDATE ON "public"."debt_installments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_goals_updated_at" BEFORE UPDATE ON "public"."savings_goals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_events_updated_at" BEFORE UPDATE ON "public"."financial_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_merchant_rules_updated_at" BEFORE UPDATE ON "public"."merchant_category_rules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "trg_device_tokens_updated_at" BEFORE UPDATE ON "public"."device_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

ALTER TABLE "public"."financial_accounts" ADD CONSTRAINT "financial_accounts_days" CHECK (("billing_day" IS NULL OR "billing_day" BETWEEN 1 AND 31) AND ("payment_due_day" IS NULL OR "payment_due_day" BETWEEN 1 AND 31));
ALTER TABLE "public"."recurrence_rules" ADD CONSTRAINT "recurrence_date_range" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transaction_accounts" CHECK ("destination_account_id" IS NULL OR "destination_account_id" <> "account_id");
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transaction_ai_confidence" CHECK ("ai_confidence" IS NULL OR "ai_confidence" BETWEEN 0 AND 1);
ALTER TABLE "public"."budgets" ADD CONSTRAINT "budget_date_range" CHECK ("ends_on" >= "starts_on");
ALTER TABLE "public"."budget_categories" ADD CONSTRAINT "budget_category_amount" CHECK ("allocated_amount" > 0);
ALTER TABLE "public"."financial_events" ADD CONSTRAINT "financial_event_dates" CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at");
ALTER TABLE "public"."forecasts" ADD CONSTRAINT "forecast_date_range" CHECK ("period_end" >= "period_start");
