ALTER TABLE "public"."financial_accounts"
  ADD COLUMN "reference_periodic_rate" DECIMAL(10,7),
  ADD COLUMN "reference_rate_source" VARCHAR(20);

ALTER TABLE "public"."card_purchases"
  ADD COLUMN "rate_source" VARCHAR(20) NOT NULL DEFAULT 'ESTIMATED';

ALTER TABLE "public"."card_cash_advances"
  ADD COLUMN "rate_source" VARCHAR(20) NOT NULL DEFAULT 'ESTIMATED';

ALTER TABLE "public"."financial_accounts"
  ADD CONSTRAINT "financial_accounts_reference_rate_source_check"
  CHECK ("reference_rate_source" IS NULL OR "reference_rate_source" IN ('INFORMED', 'ESTIMATED'));

ALTER TABLE "public"."card_purchases"
  ADD CONSTRAINT "card_purchases_rate_source_check"
  CHECK ("rate_source" IN ('INFORMED', 'ESTIMATED'));

ALTER TABLE "public"."card_cash_advances"
  ADD CONSTRAINT "card_cash_advances_rate_source_check"
  CHECK ("rate_source" IN ('INFORMED', 'ESTIMATED'));
