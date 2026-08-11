BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM budgets) THEN
    RAISE EXCEPTION 'No se puede agregar budgets.currency mientras existan presupuestos sin estrategia de backfill';
  END IF;
END
$$;

ALTER TABLE budgets
ADD COLUMN currency CHAR(3) NOT NULL;

ALTER TABLE budgets
ADD CONSTRAINT chk_budgets_currency_format
CHECK (currency ~ '^[A-Z]{3}$');

COMMIT;
