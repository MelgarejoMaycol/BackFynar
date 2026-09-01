ALTER TABLE "obligation_payments"
DROP CONSTRAINT "obligation_payments_workspace_id_occurrence_id_fkey";

ALTER TABLE "obligation_payments"
ADD CONSTRAINT "obligation_payments_workspace_id_occurrence_id_fkey"
FOREIGN KEY ("workspace_id", "occurrence_id")
REFERENCES "obligation_occurrences"("workspace_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
