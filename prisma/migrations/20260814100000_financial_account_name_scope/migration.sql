DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."financial_accounts"
    WHERE "deleted_at" IS NULL
    GROUP BY "workspace_id", "type", lower(btrim(regexp_replace("name", '[[:space:]]+', ' ', 'g')))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce normalized account name uniqueness: resolve duplicate active names per workspace and type first';
  END IF;
END $$;

ALTER TABLE "public"."financial_accounts"
  DROP CONSTRAINT IF EXISTS "financial_accounts_workspace_id_name_key";

CREATE UNIQUE INDEX "financial_accounts_workspace_type_normalized_name_active_key"
  ON "public"."financial_accounts" (
    "workspace_id",
    "type",
    lower(btrim(regexp_replace("name", '[[:space:]]+', ' ', 'g')))
  )
  WHERE "deleted_at" IS NULL;
