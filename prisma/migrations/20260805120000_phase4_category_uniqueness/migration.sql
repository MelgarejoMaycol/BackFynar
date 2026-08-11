BEGIN;

DO $$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(
    format(
      'workspace=%s, parent=%s, type=%s, normalized_name=%s, count=%s',
      workspace_key,
      parent_key,
      type,
      normalized_name,
      duplicate_count
    ),
    E'\n'
  )
  INTO collisions
  FROM (
    SELECT
      COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid) AS workspace_key,
      COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid) AS parent_key,
      type,
      lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) AS normalized_name,
      count(*) AS duplicate_count
    FROM categories
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) duplicates;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION E'No se puede reemplazar el índice de categorías porque existen colisiones:\n%', collisions;
  END IF;
END
$$;

DROP INDEX "public"."uq_categories_workspace_name_type";

CREATE UNIQUE INDEX "uq_categories_workspace_name_type_parent"
ON "public"."categories" (
  COALESCE("workspace_id", '00000000-0000-0000-0000-000000000000'::uuid),
  lower(btrim(regexp_replace("name", '[[:space:]]+', ' ', 'g'))),
  "type",
  COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid)
);

COMMIT;
