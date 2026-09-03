CREATE TABLE IF NOT EXISTS "goal_contribution_allocations" (
  "contribution_id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "goal_contribution_allocations_contribution_fkey"
    FOREIGN KEY ("contribution_id") REFERENCES "goal_contributions"("id") ON DELETE CASCADE,
  CONSTRAINT "goal_contribution_allocations_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "goal_contribution_allocations_account_fkey"
    FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "goal_contribution_allocations_workspace_account_idx"
  ON "goal_contribution_allocations" ("workspace_id", "account_id");

-- Conserva la atribución de los aportes existentes cuando la meta ya tenía una cuenta asociada.
INSERT INTO "goal_contribution_allocations" ("contribution_id", "workspace_id", "account_id")
SELECT gc."id", sg."workspace_id", sg."account_id"
FROM "goal_contributions" gc
JOIN "savings_goals" sg ON sg."id" = gc."goal_id"
WHERE sg."account_id" IS NOT NULL
ON CONFLICT ("contribution_id") DO NOTHING;
