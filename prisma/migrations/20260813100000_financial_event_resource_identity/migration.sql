ALTER TABLE "public"."financial_events"
  ADD COLUMN "related_obligation_occurrence_id" UUID,
  ADD COLUMN "related_card_statement_id" UUID;

-- Existing obligation events can be linked unambiguously because occurrences are
-- unique by workspace, obligation and due date. Keep only the oldest event linked
-- if legacy duplicate events exist; the remaining legacy rows stay as history.
WITH candidates AS (
  SELECT fe.id AS event_id, oo.id AS occurrence_id,
         row_number() OVER (PARTITION BY oo.id ORDER BY fe.created_at, fe.id) AS position
  FROM "public"."financial_events" fe
  JOIN "public"."obligation_occurrences" oo
    ON oo.workspace_id = fe.workspace_id
   AND oo.obligation_id = fe.related_obligation_id
   AND oo.due_date = fe.starts_at::date
  WHERE fe.type = 'RECURRING_OBLIGATION'
)
UPDATE "public"."financial_events" fe
SET "related_obligation_occurrence_id" = candidates.occurrence_id
FROM candidates
WHERE fe.id = candidates.event_id AND candidates.position = 1;

-- Card account names are unique per workspace, but two statement periods may
-- share a due date. Link legacy rows only when both sides have exactly one match.
WITH matches AS (
  SELECT fe.id AS event_id, cs.id AS statement_id, fe.created_at
  FROM "public"."financial_events" fe
  JOIN "public"."card_statements" cs
    ON cs.workspace_id = fe.workspace_id
   AND cs.due_date = fe.starts_at::date
  JOIN "public"."financial_accounts" account
    ON account.workspace_id = cs.workspace_id
   AND account.id = cs.card_account_id
   AND fe.title = 'Pago tarjeta ' || account.name
  WHERE fe.type = 'CARD_PAYMENT'
), unambiguous_events AS (
  SELECT event_id, statement_id, created_at
  FROM (
    SELECT event_id, statement_id, created_at,
           count(*) OVER (PARTITION BY event_id) AS statements_per_event
    FROM matches
  ) counted
  WHERE statements_per_event = 1
), candidates AS (
  SELECT event_id, statement_id,
         row_number() OVER (PARTITION BY statement_id ORDER BY created_at, event_id) AS position
  FROM unambiguous_events
)
UPDATE "public"."financial_events" fe
SET "related_card_statement_id" = candidates.statement_id
FROM candidates
WHERE fe.id = candidates.event_id AND candidates.position = 1;

-- Preserve duplicate legacy rows as unlinked history while enforcing that all
-- future installment events are one-to-one.
WITH duplicates AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY related_debt_installment_id ORDER BY created_at, id
         ) AS position
  FROM "public"."financial_events"
  WHERE related_debt_installment_id IS NOT NULL
)
UPDATE "public"."financial_events" fe
SET "related_debt_installment_id" = NULL
FROM duplicates
WHERE fe.id = duplicates.id AND duplicates.position > 1;

CREATE UNIQUE INDEX "financial_events_workspace_debt_installment_key"
  ON "public"."financial_events"("workspace_id", "related_debt_id", "related_debt_installment_id");
CREATE UNIQUE INDEX "financial_events_workspace_occurrence_key"
  ON "public"."financial_events"("workspace_id", "related_obligation_occurrence_id");
CREATE UNIQUE INDEX "financial_events_workspace_card_statement_key"
  ON "public"."financial_events"("workspace_id", "related_card_statement_id");
CREATE UNIQUE INDEX "obligation_occurrences_workspace_id_id_key"
  ON "public"."obligation_occurrences"("workspace_id", "id");
CREATE UNIQUE INDEX "card_statements_workspace_id_id_key"
  ON "public"."card_statements"("workspace_id", "id");

ALTER TABLE "public"."financial_events"
  ADD CONSTRAINT "financial_events_workspace_occurrence_fkey"
    FOREIGN KEY ("workspace_id", "related_obligation_occurrence_id")
    REFERENCES "public"."obligation_occurrences"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "financial_events_workspace_card_statement_fkey"
    FOREIGN KEY ("workspace_id", "related_card_statement_id")
    REFERENCES "public"."card_statements"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
