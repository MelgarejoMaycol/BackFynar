ALTER TABLE personal_balances ADD COLUMN settled_at timestamptz;

UPDATE personal_balances balance
SET settled_at = COALESCE((
  SELECT max(entry.occurred_at)
  FROM personal_balance_entries entry
  WHERE entry.workspace_id = balance.workspace_id
    AND entry.balance_id = balance.id
    AND entry.entry_type = 'PAYMENT'
    AND entry.reversed_at IS NULL
), balance.updated_at)
WHERE balance.status = 'SETTLED' OR balance.current_balance = 0;
