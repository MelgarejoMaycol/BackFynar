import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { BudgetsService } from "../src/modules/budgets/budgets.service.js";
import type { DashboardRepository } from "../src/modules/dashboard/dashboard.repository.js";
import { DashboardService } from "../src/modules/dashboard/dashboard.service.js";
import type { LiabilitiesService } from "../src/modules/liabilities/liabilities.service.js";

describe("forecast de liquidez", () => {
  it("separa liquidez, cuentas por cobrar y pagos futuros sin duplicar eventos", async () => {
    const repository = {
      financialCycleStartDay: vi.fn(),
      read: vi.fn().mockResolvedValue({
        accounts: [
          {
            id: "account",
            name: "Disponible",
            type: "SAVINGS",
            nature: "ASSET",
            currency: "COP",
            currentBalance: new Prisma.Decimal(1000),
            isFavorite: false,
            includeInNetWorth: true,
          },
        ],
        receivables: [
          {
            currency: "COP",
            _sum: { currentBalance: new Prisma.Decimal(500) },
          },
        ],
        currentTotals: [],
        previousTotals: [],
        recentTransactions: [],
        expenses: [],
        categories: [],
        goalReservations: [],
      }),
      loanCollections: vi
        .fn()
        .mockResolvedValue([{ currency: "COP", amount: new Prisma.Decimal(200) }]),
    } as unknown as DashboardRepository;
    const budgets = {
      list: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as BudgetsService;
    const liabilities = {
      calendarRange: vi.fn().mockResolvedValue([
        {
          resourceId: "rent",
          date: "2026-09-20",
          amount: "100.00",
          currency: "COP",
          source: "ACTUAL",
        },
        {
          resourceId: "rent",
          date: "2026-09-20",
          amount: "100.00",
          currency: "COP",
          source: "PROJECTED",
        },
        {
          resourceId: "credit",
          date: "2026-09-25",
          amount: "50.00",
          currency: "COP",
          source: "SCHEDULED",
        },
      ]),
    } as unknown as LiabilitiesService;
    const service = new DashboardService(repository, budgets, liabilities);

    const result = await service.get(
      "workspace",
      "COP",
      "America/Bogota",
      { period: "CURRENT_MONTH", recentLimit: 5 },
      new Date("2026-09-04T12:00:00Z"),
    );

    expect(result.summariesByCurrency).toEqual([
      expect.objectContaining({
        currency: "COP",
        availableMoney: "1000.00",
        netWorth: "1500.00",
        expectedCollections: "200.00",
        scheduledPayments: "150.00",
        projectedEndLiquidity: "1050.00",
        forecastDate: "2026-09-30",
      }),
    ]);
  });
});
