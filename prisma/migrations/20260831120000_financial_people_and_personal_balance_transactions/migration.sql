CREATE TABLE financial_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  relationship varchar(80),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT financial_people_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT financial_people_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT financial_people_workspace_id_id_key UNIQUE (workspace_id, id)
);

CREATE INDEX financial_people_workspace_active_name_idx
  ON financial_people(workspace_id, is_active, name);

-- Conserva y normaliza las contrapartes de todos los registros existentes.
INSERT INTO financial_people (workspace_id, name, created_by, created_at, updated_at)
SELECT DISTINCT ON (workspace_id, lower(counterparty_name))
  workspace_id, counterparty_name, created_by, created_at, updated_at
FROM personal_balances
ORDER BY workspace_id, lower(counterparty_name), created_at;

ALTER TABLE personal_balances ADD COLUMN person_id uuid;

UPDATE personal_balances balance
SET person_id = person.id
FROM financial_people person
WHERE person.workspace_id = balance.workspace_id
  AND lower(person.name) = lower(balance.counterparty_name);

ALTER TABLE personal_balances ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE personal_balances ADD CONSTRAINT personal_balances_person_fk
  FOREIGN KEY (workspace_id, person_id) REFERENCES financial_people(workspace_id, id) ON DELETE NO ACTION;
CREATE INDEX personal_balances_workspace_person_direction_status_idx
  ON personal_balances(workspace_id, person_id, direction, status);

ALTER TABLE personal_balance_entries
  ADD COLUMN account_id uuid,
  ADD COLUMN transaction_id uuid,
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE personal_balance_entries ADD CONSTRAINT personal_balance_entries_account_fk
  FOREIGN KEY (workspace_id, account_id) REFERENCES financial_accounts(workspace_id, id) ON DELETE NO ACTION;
ALTER TABLE personal_balance_entries ADD CONSTRAINT personal_balance_entries_transaction_fk
  FOREIGN KEY (workspace_id, transaction_id) REFERENCES transactions(workspace_id, id) ON DELETE NO ACTION;
ALTER TABLE personal_balance_entries ADD CONSTRAINT personal_balance_entries_workspace_transaction_key
  UNIQUE (workspace_id, transaction_id);
