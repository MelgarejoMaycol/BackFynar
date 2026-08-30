-- Entre personas: saldos informales sin intereses, separados de créditos y pagos recurrentes.
CREATE TABLE personal_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  counterparty_name varchar(120) NOT NULL,
  direction varchar(20) NOT NULL,
  original_amount numeric(18,2) NOT NULL,
  current_balance numeric(18,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'COP',
  description varchar(250),
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  due_on date,
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT personal_balances_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT personal_balances_user_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT personal_balances_direction_check CHECK (direction IN ('PAYABLE','RECEIVABLE')),
  CONSTRAINT personal_balances_status_check CHECK (status IN ('OPEN','PARTIAL','SETTLED','CANCELLED')),
  CONSTRAINT personal_balances_original_amount_check CHECK (original_amount > 0),
  CONSTRAINT personal_balances_current_balance_check CHECK (current_balance >= 0),
  CONSTRAINT personal_balances_workspace_id_id_key UNIQUE (workspace_id, id)
);

CREATE INDEX idx_personal_balances_workspace_direction_status
  ON personal_balances(workspace_id, direction, status);
CREATE INDEX idx_personal_balances_workspace_due
  ON personal_balances(workspace_id, due_on)
  WHERE deleted_at IS NULL AND due_on IS NOT NULL;

CREATE TABLE personal_balance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  balance_id uuid NOT NULL,
  entry_type varchar(20) NOT NULL,
  amount numeric(18,2) NOT NULL,
  resulting_balance numeric(18,2) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_balance_entries_balance_fk FOREIGN KEY (workspace_id, balance_id)
    REFERENCES personal_balances(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT personal_balance_entries_user_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT personal_balance_entries_type_check CHECK (entry_type IN ('OPENING','INCREASE','PAYMENT','ADJUSTMENT')),
  CONSTRAINT personal_balance_entries_amount_check CHECK (amount > 0),
  CONSTRAINT personal_balance_entries_resulting_balance_check CHECK (resulting_balance >= 0)
);

CREATE INDEX idx_personal_balance_entries_balance_date
  ON personal_balance_entries(workspace_id, balance_id, occurred_at DESC);
