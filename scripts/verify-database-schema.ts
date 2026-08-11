import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const expectedTables = [
  "account_balance_snapshots",
  "ai_insights",
  "audit_logs",
  "auth_identities",
  "budget_accounts",
  "budget_categories",
  "budgets",
  "categories",
  "debt_installments",
  "debt_payments",
  "debts",
  "device_tokens",
  "financial_accounts",
  "financial_events",
  "financial_simulations",
  "forecasts",
  "goal_contributions",
  "merchant_category_rules",
  "notifications",
  "outbox_events",
  "password_reset_tokens",
  "permissions",
  "recurrence_rules",
  "refresh_tokens",
  "role_permissions",
  "roles",
  "savings_goals",
  "transaction_attachments",
  "transaction_splits",
  "transactions",
  "user_preferences",
  "users",
  "workspace_members",
  "workspaces",
] as const;
const expectedEnums = [
  "account_nature",
  "account_type",
  "budget_period",
  "category_type",
  "debt_status",
  "debt_type",
  "event_type",
  "forecast_type",
  "goal_status",
  "insight_type",
  "installment_status",
  "interest_type",
  "member_status",
  "notification_type",
  "provider_type",
  "recurrence_frequency",
  "transaction_status",
  "transaction_type",
  "workspace_type",
] as const;
const expectedIndexes = [
  "uq_categories_workspace_name_type_parent",
  "idx_workspace_members_user",
  "idx_accounts_workspace_active",
  "idx_categories_workspace_type",
  "idx_transactions_workspace_date",
  "idx_transactions_account_date",
  "idx_transactions_destination_date",
  "idx_transactions_category_date",
  "idx_transactions_search",
  "idx_budgets_workspace_period",
  "idx_debts_workspace_status",
  "idx_installments_due_status",
  "idx_events_workspace_start",
  "idx_goals_workspace_status",
  "idx_insights_workspace_created",
  "idx_forecasts_workspace_period",
  "idx_notifications_user_unread",
  "idx_outbox_unprocessed",
  "idx_audit_workspace_created",
  "idx_password_reset_user_active",
  "idx_password_reset_expires",
  "idx_refresh_tokens_family",
  "idx_refresh_tokens_user_active",
  "idx_refresh_tokens_expires",
] as const;
const expectedTriggers = [
  "trg_users_updated_at",
  "trg_workspaces_updated_at",
  "trg_user_preferences_updated_at",
  "trg_accounts_updated_at",
  "trg_categories_updated_at",
  "trg_recurrence_rules_updated_at",
  "trg_transactions_updated_at",
  "trg_budgets_updated_at",
  "trg_debts_updated_at",
  "trg_installments_updated_at",
  "trg_goals_updated_at",
  "trg_events_updated_at",
  "trg_merchant_rules_updated_at",
  "trg_device_tokens_updated_at",
] as const;
const expectedChecks = [
  "users_password_or_external_provider",
  "financial_accounts_days",
  "recurrence_date_range",
  "transaction_accounts",
  "transaction_ai_confidence",
  "budget_date_range",
  "budget_category_amount",
  "chk_budgets_currency_format",
  "financial_event_dates",
  "forecast_date_range",
] as const;

interface NamedRow {
  name: string;
}
interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  column_default: string | null;
  is_nullable: "YES" | "NO";
  character_maximum_length: number | null;
}
interface ConstraintRow {
  table_name: string;
  name: string;
  type: string;
}

const prisma = new PrismaClient();
const missing: string[] = [];
const absent = (kind: string, expected: readonly string[], actual: Set<string>): void => {
  for (const name of expected) if (!actual.has(name)) missing.push(`${kind}:${name}`);
};

async function main(): Promise<void> {
  const [tables, enums, indexes, triggers, extensions, columns, constraints] = await Promise.all([
    prisma.$queryRaw<
      NamedRow[]
    >`SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    prisma.$queryRaw<
      NamedRow[]
    >`SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'`,
    prisma.$queryRaw<
      NamedRow[]
    >`SELECT indexname AS name FROM pg_indexes WHERE schemaname='public'`,
    prisma.$queryRaw<
      NamedRow[]
    >`SELECT DISTINCT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema='public'`,
    prisma.$queryRaw<NamedRow[]>`SELECT extname AS name FROM pg_extension`,
    prisma.$queryRaw<
      ColumnRow[]
    >`SELECT table_name, column_name, data_type, udt_name, column_default, is_nullable, character_maximum_length FROM information_schema.columns WHERE table_schema='public'`,
    prisma.$queryRaw<
      ConstraintRow[]
    >`SELECT c.relname AS table_name, con.conname AS name, con.contype::text AS type FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`,
  ]);
  const tableNames = new Set(tables.map((row) => row.name));
  absent("table", expectedTables, tableNames);
  if (tables.length !== expectedTables.length) missing.push(`table-count:${tables.length}`);
  absent("enum", expectedEnums, new Set(enums.map((row) => row.name)));
  absent("index", expectedIndexes, new Set(indexes.map((row) => row.name)));
  absent("trigger", expectedTriggers, new Set(triggers.map((row) => row.name)));
  absent("extension", ["pgcrypto", "citext"], new Set(extensions.map((row) => row.name)));

  const columnKey = (table: string, column: string): string => `${table}.${column}`;
  const typedColumns = new Map(
    columns.map((row) => [columnKey(row.table_name, row.column_name), row]),
  );
  const budgetCurrency = typedColumns.get("budgets.currency");
  if (!budgetCurrency) missing.push("column:budgets.currency");
  else {
    if (budgetCurrency.udt_name !== "bpchar" || budgetCurrency.character_maximum_length !== 3)
      missing.push("type:budgets.currency");
    if (budgetCurrency.is_nullable !== "NO") missing.push("not-null:budgets.currency");
  }
  for (const key of ["users.email", "auth_identities.provider_email"])
    if (typedColumns.get(key)?.udt_name !== "citext") missing.push(`citext:${key}`);
  for (const key of ["refresh_tokens.ip_address", "audit_logs.ip_address"])
    if (typedColumns.get(key)?.udt_name !== "inet") missing.push(`inet:${key}`);
  for (const key of [
    "user_preferences.dashboard_layout",
    "transactions.metadata",
    "debts.metadata",
    "ai_insights.data",
    "forecasts.assumptions",
    "financial_simulations.input_data",
    "financial_simulations.result_data",
    "notifications.data",
    "audit_logs.old_data",
    "audit_logs.new_data",
    "outbox_events.payload",
  ])
    if (typedColumns.get(key)?.udt_name !== "jsonb") missing.push(`jsonb:${key}`);

  const uuidColumns = columns.filter((column) => column.udt_name === "uuid");
  if (uuidColumns.length === 0) missing.push("type:uuid");
  const defaults = columns.filter((column) => column.column_default !== null);
  if (!defaults.some((column) => column.column_default?.includes("gen_random_uuid")))
    missing.push("default:gen_random_uuid");
  for (const table of [
    "users",
    "workspaces",
    "financial_accounts",
    "categories",
    "transactions",
    "budgets",
    "debts",
    "savings_goals",
  ])
    if (!typedColumns.has(columnKey(table, "deleted_at"))) missing.push(`soft-delete:${table}`);
  for (const table of [
    "users",
    "workspaces",
    "user_preferences",
    "financial_accounts",
    "categories",
    "recurrence_rules",
    "transactions",
    "budgets",
    "debts",
    "debt_installments",
    "savings_goals",
    "financial_events",
    "merchant_category_rules",
    "device_tokens",
  ])
    if (!typedColumns.has(columnKey(table, "updated_at"))) missing.push(`updated-at:${table}`);

  const primaryTables = new Set(
    constraints.filter((row) => row.type === "p").map((row) => row.table_name),
  );
  absent("primary-key", expectedTables, primaryTables);
  if (!constraints.some((row) => row.type === "f")) missing.push("constraints:foreign-keys");
  if (!constraints.some((row) => row.type === "u")) missing.push("constraints:unique");
  absent(
    "check",
    expectedChecks,
    new Set(constraints.filter((row) => row.type === "c").map((row) => row.name)),
  );

  const summary = {
    valid: missing.length === 0,
    tables: tables.length,
    enums: enums.length,
    explicitIndexes: expectedIndexes.filter((name) => indexes.some((row) => row.name === name))
      .length,
    triggers: triggers.length,
    requiredExtensions: ["pgcrypto", "citext"].filter((name) =>
      extensions.some((row) => row.name === name),
    ).length,
    primaryKeys: constraints.filter((row) => row.type === "p").length,
    foreignKeys: constraints.filter((row) => row.type === "f").length,
    uniqueConstraints: constraints.filter((row) => row.type === "u").length,
    checkConstraints: constraints.filter((row) => row.type === "c").length,
    uuidColumns: uuidColumns.length,
    missing,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (missing.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({ valid: false, errorName: error instanceof Error ? error.name : "Unknown" }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch (error: unknown) {
      console.error(
        JSON.stringify({ disconnectError: error instanceof Error ? error.name : "Unknown" }),
      );
      process.exitCode = 1;
    }
  });
