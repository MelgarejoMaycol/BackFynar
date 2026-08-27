ALTER TABLE "public"."user_preferences"
ADD COLUMN "financial_cycle_start_day" SMALLINT;

ALTER TABLE "public"."user_preferences"
ADD CONSTRAINT "user_preferences_financial_cycle_start_day_check"
CHECK ("financial_cycle_start_day" IS NULL OR "financial_cycle_start_day" BETWEEN 1 AND 28);
