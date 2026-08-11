import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import type { AccountBalancesReportQuery, CommonReportQuery } from "./reports.schemas.js";
import type { ReportPeriod } from "./reports.period.js";
export interface TotalRow {
  currency: string;
  type: "INCOME" | "EXPENSE";
  amount: Prisma.Decimal;
  count: number;
}
export interface CategoryRow {
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  icon: string | null;
  color: string | null;
  amount: Prisma.Decimal;
  count: number;
}
export interface DailyRow {
  currency: string;
  localDate: Date;
  type: "INCOME" | "EXPENSE";
  amount: Prisma.Decimal;
  count: number;
}
const filters = (workspaceId: string, start: Date, end: Date, q: CommonReportQuery) =>
  Prisma.sql`t.workspace_id::text=${workspaceId} AND t.status='CONFIRMED'::transaction_status AND t.deleted_at IS NULL AND t.type IN ('INCOME'::transaction_type,'EXPENSE'::transaction_type) AND t.occurred_at>=${start} AND t.occurred_at<${end} ${q.currency ? Prisma.sql`AND t.currency=${q.currency}` : Prisma.empty}${q.accountId ? Prisma.sql` AND t.account_id::text=${q.accountId}` : Prisma.empty}${q.categoryId ? Prisma.sql` AND t.category_id::text=${q.categoryId}` : Prisma.empty}`;
export class ReportsRepository {
  constructor(private readonly db: PrismaClient = prisma) {}
  validateAccount(workspaceId: string, id: string) {
    return this.db.financialAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
  }
  validateCategory(workspaceId: string, id: string) {
    return this.db.category.findFirst({
      where: { id, OR: [{ workspaceId }, { workspaceId: null, isSystem: true }] },
      select: { id: true },
    });
  }
  totals(workspaceId: string, p: ReportPeriod, q: CommonReportQuery, previous = false) {
    const start = previous ? p.previousStart : p.start,
      end = previous ? p.previousEndExclusive : p.endExclusive;
    return this.db.$queryRaw<TotalRow[]>(
      Prisma.sql`SELECT t.currency,t.type,COALESCE(SUM(t.amount),0)::numeric amount,COUNT(*)::int count FROM transactions t WHERE ${filters(workspaceId, start, end, q)} GROUP BY t.currency,t.type ORDER BY t.currency,t.type`,
    );
  }
  categories(workspaceId: string, p: ReportPeriod, q: CommonReportQuery) {
    return this.db.$queryRaw<CategoryRow[]>(
      Prisma.sql`SELECT t.currency,t.category_id AS "categoryId",c.name AS "categoryName",c.icon,c.color,SUM(t.amount)::numeric amount,COUNT(*)::int count FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE ${filters(workspaceId, p.start, p.endExclusive, q)} AND t.type='EXPENSE'::transaction_type GROUP BY t.currency,t.category_id,c.name,c.icon,c.color ORDER BY t.currency,amount DESC,c.name,t.category_id`,
    );
  }
  daily(workspaceId: string, p: ReportPeriod, q: CommonReportQuery) {
    return this.db.$queryRaw<DailyRow[]>(
      Prisma.sql`SELECT t.currency,(t.occurred_at AT TIME ZONE ${p.timezone})::date AS "localDate",t.type,SUM(t.amount)::numeric amount,COUNT(*)::int count FROM transactions t WHERE ${filters(workspaceId, p.start, p.endExclusive, q)} GROUP BY t.currency,"localDate",t.type ORDER BY t.currency,"localDate",t.type`,
    );
  }
  async accounts(workspaceId: string, q: AccountBalancesReportQuery) {
    const where: Prisma.FinancialAccountWhereInput = {
      workspaceId,
      ...(q.includeArchived === "false" ? { isActive: true, deletedAt: null } : {}),
      ...(q.currency ? { currency: q.currency } : {}),
      ...(q.nature ? { nature: q.nature } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.search ? { name: { contains: q.search, mode: "insensitive" } } : {}),
    };
    return Promise.all([
      this.db.financialAccount.findMany({
        where,
        select: {
          id: true,
          name: true,
          type: true,
          nature: true,
          currency: true,
          currentBalance: true,
          isFavorite: true,
          includeInNetWorth: true,
          isActive: true,
        },
        orderBy: [{ currency: "asc" }, { isFavorite: "desc" }, { name: "asc" }, { id: "asc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.financialAccount.count({ where }),
      this.db.$queryRaw<
        {
          currency: string;
          assetBalance: Prisma.Decimal;
          liabilityBalance: Prisma.Decimal;
          netWorth: Prisma.Decimal;
          availableMoney: Prisma.Decimal;
          accountCount: number;
        }[]
      >(
        Prisma.sql`SELECT currency,COALESCE(SUM(current_balance) FILTER(WHERE nature='ASSET'),0)::numeric AS "assetBalance",COALESCE(SUM(ABS(current_balance)) FILTER(WHERE nature='LIABILITY'),0)::numeric AS "liabilityBalance",COALESCE(SUM(CASE WHEN include_in_net_worth AND nature='ASSET' THEN current_balance WHEN include_in_net_worth AND nature='LIABILITY' THEN -ABS(current_balance) ELSE 0 END),0)::numeric AS "netWorth",COALESCE(SUM(current_balance) FILTER(WHERE nature='ASSET'),0)::numeric AS "availableMoney",COUNT(*)::int AS "accountCount" FROM financial_accounts WHERE workspace_id::text=${workspaceId} AND is_active=true AND deleted_at IS NULL ${q.currency ? Prisma.sql`AND currency=${q.currency}` : Prisma.empty}${q.nature ? Prisma.sql` AND nature=${q.nature}::account_nature` : Prisma.empty}${q.type ? Prisma.sql` AND type=${q.type}::account_type` : Prisma.empty}${q.search ? Prisma.sql` AND name ILIKE ${`%${q.search}%`}` : Prisma.empty} GROUP BY currency ORDER BY currency`,
      ),
    ]);
  }
}
export const reportsRepository = new ReportsRepository();
