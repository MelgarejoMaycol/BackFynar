import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  cardStatementEventWhere,
  debtInstallmentEventWhere,
  obligationEventWhere,
  syncFinancialEvent,
} from "../src/modules/liabilities/financial-event-sync.service.js";

describe("identidad y sincronización de FinancialEvent", () => {
  it("selecciona cada recurso por un identificador estable", () => {
    expect(debtInstallmentEventWhere("workspace", "installment")).toEqual({
      workspaceId: "workspace",
      type: "DEBT_INSTALLMENT_DUE",
      relatedDebtInstallmentId: "installment",
    });
    expect(obligationEventWhere("workspace", "occurrence")).toEqual({
      workspaceId: "workspace",
      relatedObligationOccurrenceId: "occurrence",
    });
    expect(cardStatementEventWhere("workspace", "statement")).toEqual({
      workspaceId: "workspace",
      relatedCardStatementId: "statement",
    });
  });

  it("persiste exclusivamente remanente y resolución", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await syncFinancialEvent(
      { financialEvent: { updateMany } } as never,
      obligationEventWhere("workspace", "occurrence"),
      { isCompleted: false, remainingAmount: new Prisma.Decimal("25.50") },
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace", relatedObligationOccurrenceId: "occurrence" },
      data: {
        isCompleted: false,
        amount: new Prisma.Decimal("25.50"),
        updatedAt: expect.any(Date),
      },
    });
  });
});
