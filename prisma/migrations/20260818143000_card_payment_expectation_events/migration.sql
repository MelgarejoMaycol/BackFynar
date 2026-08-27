ALTER TABLE "public"."financial_events"
  ADD COLUMN "related_card_payment_expectation_id" UUID;

CREATE UNIQUE INDEX "financial_events_workspace_id_related_card_payment_expectation_id_key"
  ON "public"."financial_events"("workspace_id", "related_card_payment_expectation_id");

ALTER TABLE "public"."financial_events"
  ADD CONSTRAINT "financial_events_card_payment_expectation_fkey"
  FOREIGN KEY ("workspace_id", "related_card_payment_expectation_id")
  REFERENCES "public"."card_payment_expectations"("workspace_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
