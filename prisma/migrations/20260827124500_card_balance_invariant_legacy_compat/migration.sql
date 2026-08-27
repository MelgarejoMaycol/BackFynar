ALTER TABLE "financial_accounts"
DROP CONSTRAINT "financial_accounts_credit_card_balance_check";

ALTER TABLE "financial_accounts"
ADD CONSTRAINT "financial_accounts_credit_card_balance_check"
CHECK (
  "type" <> 'CREDIT_CARD'
  OR "credit_limit" IS NULL
  OR (
    "credit_limit" >= 0
    AND "current_balance" >= 0
    AND "current_balance" <= "credit_limit"
  )
) NOT VALID;
