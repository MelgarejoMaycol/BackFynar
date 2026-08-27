DO $$
BEGIN
  IF to_regclass('public.uq_categories_workspace_name_type_parent') IS NULL
     AND to_regclass('public.uq_categories_workspace_name_type') IS NULL THEN
    CREATE UNIQUE INDEX "uq_categories_workspace_name_type"
    ON "public"."categories" ("workspace_id", "name", "type");
  END IF;
END
$$;
