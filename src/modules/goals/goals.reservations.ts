import { Prisma } from "@prisma/client";

export type ReservationClient = Prisma.TransactionClient;

export interface AccountReservation {
  accountId: string;
  reservedForGoals: Prisma.Decimal;
}

export interface ContributionAllocation {
  contributionId: string;
  accountId: string;
  accountName: string;
  currency: string;
}

export async function reservationsByAccount(
  client: ReservationClient,
  workspaceId: string,
): Promise<AccountReservation[]> {
  const rows = await client.$queryRaw<
    Array<{ accountId: string; reservedForGoals: Prisma.Decimal }>
  >(Prisma.sql`
    SELECT
      gca.account_id AS "accountId",
      COALESCE(SUM(gc.amount), 0)::numeric(18,2) AS "reservedForGoals"
    FROM goal_contribution_allocations gca
    JOIN goal_contributions gc ON gc.id = gca.contribution_id
    JOIN savings_goals sg ON sg.id = gc.goal_id
    WHERE gca.workspace_id = ${workspaceId}::uuid
      AND sg.deleted_at IS NULL
      AND sg.status <> 'CANCELLED'::goal_status
    GROUP BY gca.account_id
  `);
  return rows;
}

export async function reservedForGoalAccount(
  client: ReservationClient,
  goalId: string,
  accountId: string,
): Promise<Prisma.Decimal> {
  const rows = await client.$queryRaw<Array<{ amount: Prisma.Decimal }>>(Prisma.sql`
    SELECT COALESCE(SUM(gc.amount), 0)::numeric(18,2) AS amount
    FROM goal_contributions gc
    JOIN goal_contribution_allocations gca ON gca.contribution_id = gc.id
    WHERE gc.goal_id = ${goalId}::uuid
      AND gca.account_id = ${accountId}::uuid
  `);
  return rows[0]?.amount ?? new Prisma.Decimal(0);
}

export async function attachContributionToAccount(
  client: ReservationClient,
  input: { contributionId: string; workspaceId: string; accountId: string },
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    INSERT INTO goal_contribution_allocations (contribution_id, workspace_id, account_id)
    VALUES (${input.contributionId}::uuid, ${input.workspaceId}::uuid, ${input.accountId}::uuid)
    ON CONFLICT (contribution_id)
    DO UPDATE SET workspace_id = EXCLUDED.workspace_id, account_id = EXCLUDED.account_id
  `);
}

export async function contributionAllocations(
  client: ReservationClient,
  workspaceId: string,
  contributionIds: string[],
): Promise<ContributionAllocation[]> {
  if (contributionIds.length === 0) return [];
  return client.$queryRaw<ContributionAllocation[]>(Prisma.sql`
    SELECT
      gca.contribution_id AS "contributionId",
      gca.account_id AS "accountId",
      fa.name AS "accountName",
      TRIM(fa.currency) AS currency
    FROM goal_contribution_allocations gca
    JOIN financial_accounts fa ON fa.id = gca.account_id
    WHERE gca.workspace_id = ${workspaceId}::uuid
      AND gca.contribution_id IN (${Prisma.join(contributionIds.map((id) => Prisma.sql`${id}::uuid`))})
  `);
}

export async function contributionAllocation(
  client: ReservationClient,
  workspaceId: string,
  contributionId: string,
): Promise<ContributionAllocation | null> {
  const rows = await contributionAllocations(client, workspaceId, [contributionId]);
  return rows[0] ?? null;
}
