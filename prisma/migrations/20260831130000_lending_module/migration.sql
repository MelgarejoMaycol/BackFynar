CREATE TABLE issued_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  receivable_account_id uuid NOT NULL REFERENCES financial_accounts(id),
  source_account_id uuid NULL REFERENCES financial_accounts(id),
  borrower_name varchar(150) NOT NULL,
  borrower_phone varchar(40),
  borrower_document varchar(80),
  currency char(3) NOT NULL DEFAULT 'COP',
  original_principal numeric(18,2) NOT NULL CHECK (original_principal > 0),
  current_principal numeric(18,2) NOT NULL CHECK (current_principal >= 0),
  rate_percent numeric(10,6) NOT NULL DEFAULT 0 CHECK (rate_percent >= 0),
  method varchar(24) NOT NULL CHECK (method IN ('FIXED_PAYMENT','FIXED_PRINCIPAL','INTEREST_ONLY')),
  frequency varchar(16) NOT NULL CHECK (frequency IN ('WEEKLY','BIWEEKLY','MONTHLY')),
  term_count integer NOT NULL CHECK (term_count > 0 AND term_count <= 600),
  installment_amount numeric(18,2) NOT NULL,
  expected_interest numeric(18,2) NOT NULL DEFAULT 0,
  expected_total numeric(18,2) NOT NULL,
  interest_received numeric(18,2) NOT NULL DEFAULT 0,
  principal_received numeric(18,2) NOT NULL DEFAULT 0,
  disbursement_date date NOT NULL,
  first_payment_date date NOT NULL,
  next_due_date date,
  estimated_end_date date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAID','OVERDUE','CANCELLED')),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX issued_loans_workspace_id_id_uq ON issued_loans(workspace_id,id);
CREATE INDEX issued_loans_workspace_status_due_idx ON issued_loans(workspace_id,status,next_due_date) WHERE deleted_at IS NULL;

CREATE TABLE issued_loan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  loan_id uuid NOT NULL,
  installment_number integer NOT NULL,
  due_date date NOT NULL,
  opening_principal numeric(18,2) NOT NULL,
  principal_amount numeric(18,2) NOT NULL DEFAULT 0,
  interest_amount numeric(18,2) NOT NULL DEFAULT 0,
  total_amount numeric(18,2) NOT NULL,
  principal_paid numeric(18,2) NOT NULL DEFAULT 0,
  interest_paid numeric(18,2) NOT NULL DEFAULT 0,
  total_paid numeric(18,2) NOT NULL DEFAULT 0,
  closing_principal numeric(18,2) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PARTIAL','PAID','OVERDUE','CANCELLED')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issued_loan_installments_loan_fk FOREIGN KEY (workspace_id,loan_id) REFERENCES issued_loans(workspace_id,id) ON DELETE CASCADE,
  UNIQUE (loan_id,installment_number)
);
CREATE INDEX issued_loan_installments_due_idx ON issued_loan_installments(workspace_id,status,due_date);

CREATE TABLE issued_loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  loan_id uuid NOT NULL,
  installment_id uuid,
  receiving_account_id uuid NOT NULL REFERENCES financial_accounts(id),
  principal_transaction_id uuid REFERENCES transactions(id),
  interest_transaction_id uuid REFERENCES transactions(id),
  total_received numeric(18,2) NOT NULL CHECK (total_received > 0),
  principal_received numeric(18,2) NOT NULL DEFAULT 0,
  interest_received numeric(18,2) NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL,
  notes text,
  idempotency_key varchar(100) NOT NULL,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issued_loan_payments_loan_fk FOREIGN KEY (workspace_id,loan_id) REFERENCES issued_loans(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (installment_id) REFERENCES issued_loan_installments(id),
  UNIQUE (workspace_id,idempotency_key)
);
CREATE INDEX issued_loan_payments_loan_idx ON issued_loan_payments(workspace_id,loan_id,occurred_at DESC);
