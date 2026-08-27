CREATE TYPE "debt_payment_frequency" AS ENUM ('WEEKLY', 'MONTHLY', 'BIMONTHLY', 'SEMIANNUAL');

ALTER TABLE "debts"
ADD COLUMN "payment_frequency" "debt_payment_frequency" NOT NULL DEFAULT 'MONTHLY';
