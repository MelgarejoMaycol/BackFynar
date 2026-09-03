import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { reservationsByAccount } from "../goals/goals.reservations.js";

export class ForecastsRepository {
  constructor(private readonly database: PrismaClient = prisma) {}

  async readMonthEndInputs(
    workspaceId: string,
    now: Date,
    monthEndExclusive: Date,
    historyStart: Date,
  ) {
    const accounts = await this.database.financialAccount.findMany({
      where: {
        workspaceId,
        nature: "ASSET",
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, currency: true, currentBalance: true },
    });
    const assetAccountIds = accounts.map((account) => account.id);

    const [goalReservations, futureIncomeEvents, historicalExpenses] = await Promise.all([
      reservationsByAccount(this.database, workspaceId),
      this.database.financialEvent.findMany({
        where: {
          workspaceId,
          type: "INCOME",
          isCompleted: false,
          amount: { not: null },
          startsAt: { gte: now, lt: monthEndExclusive },
        },
        select: { id: true, title: true, amount: true, currency: true, startsAt: true },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      }),
      assetAccountIds.length
        ? this.database.transaction.findMany({
            where: {
              workspaceId,
              status: "CONFIRMED",
              deletedAt: null,
              type: "EXPENSE",
              accountId: { in: assetAccountIds },
              occurredAt: { gte: historyStart, lt: now },
              obligationPayment: null,
            },
            select: { amount: true, currency: true, occurredAt: true },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          })
        : Promise.resolve([] as Array<{ amount: Prisma.Decimal; currency: string; occurredAt: Date }>),
    ]);

    return { accounts, goalReservations, futureIncomeEvents, historicalExpenses };
  }
}

export const forecastsRepository = new ForecastsRepository();
export type MonthEndForecastReadData = Awaited<
  ReturnType<ForecastsRepository["readMonthEndInputs"]>
>;
