BEGIN;

CREATE TEMP TABLE test_accounts (workspace_id uuid, id uuid, name text);
CREATE TEMP TABLE test_occurrences (id uuid, workspace_id uuid, obligation_id uuid, due_date date);
CREATE TEMP TABLE test_statements (id uuid, workspace_id uuid, card_account_id uuid, due_date date);
CREATE TEMP TABLE test_events (
  id uuid PRIMARY KEY, workspace_id uuid, type text, title text, starts_at timestamptz,
  related_obligation_id uuid, related_debt_installment_id uuid,
  related_obligation_occurrence_id uuid, related_card_statement_id uuid,
  created_at timestamptz
);

INSERT INTO test_accounts VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'Tarjeta');
INSERT INTO test_occurrences VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', '2026-08-01'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000202', '2026-09-01');
INSERT INTO test_statements VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '2026-08-10'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '2026-09-10'),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '2026-09-10');
INSERT INTO test_events VALUES
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', 'RECURRING_OBLIGATION', 'Único', '2026-08-01', '00000000-0000-4000-8000-000000000201', null, null, null, '2026-01-01'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', 'RECURRING_OBLIGATION', 'Duplicado A', '2026-09-01', '00000000-0000-4000-8000-000000000202', null, null, null, '2026-01-01'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001', 'RECURRING_OBLIGATION', 'Duplicado B', '2026-09-01', '00000000-0000-4000-8000-000000000202', null, null, null, '2026-01-02'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000001', 'CARD_PAYMENT', 'Pago tarjeta Tarjeta', '2026-08-10', null, null, null, null, '2026-01-01'),
  ('00000000-0000-4000-8000-000000000407', '00000000-0000-4000-8000-000000000001', 'CARD_PAYMENT', 'Pago tarjeta Tarjeta', '2026-08-10', null, null, null, null, '2026-01-02'),
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000001', 'CARD_PAYMENT', 'Pago tarjeta Tarjeta', '2026-09-10', null, null, null, null, '2026-01-01'),
  ('00000000-0000-4000-8000-000000000406', '00000000-0000-4000-8000-000000000001', 'CARD_PAYMENT', 'Historia sin relación', '2025-01-01', null, null, null, null, '2025-01-01');

WITH candidates AS (
  SELECT fe.id AS event_id, occurrence.id AS occurrence_id,
         row_number() OVER (PARTITION BY occurrence.id ORDER BY fe.created_at, fe.id) AS position
  FROM test_events fe JOIN test_occurrences occurrence
    ON occurrence.workspace_id = fe.workspace_id
   AND occurrence.obligation_id = fe.related_obligation_id
   AND occurrence.due_date = fe.starts_at::date
  WHERE fe.type = 'RECURRING_OBLIGATION'
)
UPDATE test_events event SET related_obligation_occurrence_id = candidates.occurrence_id
FROM candidates WHERE event.id = candidates.event_id AND candidates.position = 1;

WITH matches AS (
  SELECT event.id AS event_id, statement.id AS statement_id, event.created_at
  FROM test_events event
  JOIN test_statements statement ON statement.workspace_id = event.workspace_id AND statement.due_date = event.starts_at::date
  JOIN test_accounts account ON account.workspace_id = statement.workspace_id
    AND account.id = statement.card_account_id AND event.title = 'Pago tarjeta ' || account.name
  WHERE event.type = 'CARD_PAYMENT'
), unambiguous_events AS (
  SELECT event_id, statement_id, created_at FROM (
    SELECT event_id, statement_id, created_at, count(*) OVER (PARTITION BY event_id) AS statements_per_event FROM matches
  ) counted WHERE statements_per_event = 1
), candidates AS (
  SELECT event_id, statement_id, row_number() OVER (PARTITION BY statement_id ORDER BY created_at, event_id) AS position
  FROM unambiguous_events
)
UPDATE test_events event SET related_card_statement_id = candidates.statement_id
FROM candidates WHERE event.id = candidates.event_id AND candidates.position = 1;

DO $$
BEGIN
  IF (SELECT related_obligation_occurrence_id FROM test_events WHERE id = '00000000-0000-4000-8000-000000000401')
       IS DISTINCT FROM '00000000-0000-4000-8000-000000000101'::uuid THEN RAISE EXCEPTION 'unique obligation was not linked'; END IF;
  IF (SELECT count(*) FROM test_events WHERE related_obligation_occurrence_id = '00000000-0000-4000-8000-000000000102') <> 1
    THEN RAISE EXCEPTION 'legacy duplicate linked more than once'; END IF;
  IF (SELECT related_card_statement_id FROM test_events WHERE id = '00000000-0000-4000-8000-000000000404')
       IS DISTINCT FROM '00000000-0000-4000-8000-000000000301'::uuid THEN RAISE EXCEPTION 'unambiguous card was not linked'; END IF;
  IF (SELECT count(*) FROM test_events WHERE related_card_statement_id = '00000000-0000-4000-8000-000000000301') <> 1
    THEN RAISE EXCEPTION 'duplicate card event linked more than once'; END IF;
  IF (SELECT related_card_statement_id FROM test_events WHERE id = '00000000-0000-4000-8000-000000000405') IS NOT NULL
    THEN RAISE EXCEPTION 'ambiguous card was linked'; END IF;
  IF (SELECT count(*) FROM test_events) <> 7 THEN RAISE EXCEPTION 'legacy history was deleted'; END IF;
END $$;

ROLLBACK;
